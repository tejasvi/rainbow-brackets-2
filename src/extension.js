/*
 * author: 2gua., tejasvi
 */
'use strict';
const vscode = require('vscode');
const { BRACKETS, ISOLATED, lineColors } = require('./brackets');
const { DocumentModel, plainTokenizer } = require('./documentModel');
const { GrammarStore } = require('./grammars');

// Lines decorated above and below the visible ones. Scrolling to within half of this of the
// decorated lines decorates again, so large documents don't send every bracket to the editor.
const MARGIN = 500;
// Scan a document for this long (ms) at a time, so that other extensions keep running.
const SLICE = 10;
// Wait this long (ms) after an edit, so that a burst of edits is handled once.
const EDIT_DELAY = 10;
// The first squiggly bracket color follows the theme, unless squigglyBracketsColor is set.
const THEMED_SQUIGGLY = { light: { color: '#484c61' }, dark: { color: '#d4d4aa' } };

class RainbowBrackets {
	constructor() {
		this.documents = new Map();
		this.decorationTypes = [];
		// Bumped when every document has to be scanned again.
		this.generation = 0;
		this.disposed = false;
		this.grammars = new GrammarStore(vscode.extensions.all);
		this.readConfiguration();
		this.disposables = [
			vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
			vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor }) => {
				const state = this.documents.get(textEditor.document.uri.toString());
				if (state && state.document === textEditor.document && state.model && state.generation === this.generation) {
					this.decorate(state, textEditor);
				}
			}),
			vscode.workspace.onDidChangeTextDocument(event => this.onDidChangeTextDocument(event)),
			// A document whose language changes is closed and opened again.
			vscode.workspace.onDidOpenTextDocument(document => this.refresh(document)),
			vscode.workspace.onDidCloseTextDocument(document => this.forget(document.uri.toString())),
			vscode.workspace.onDidChangeConfiguration(event => this.onDidChangeConfiguration(event)),
			vscode.extensions.onDidChange(() => {
				this.grammars.dispose();
				this.grammars = new GrammarStore(vscode.extensions.all);
				this.generation++;
				this.refreshAll();
			}),
		];
		this.refreshAll();
	}

	readConfiguration() {
		const config = vscode.workspace.getConfiguration('rainbowBrackets');
		// The colors in the settings, or undefined if they aren't set to a list of colors.
		const setColors = key => {
			const value = config.get(key);
			return isSet(config.inspect(key)) && Array.isArray(value) && value.length > 0 && value.every(color => typeof color === 'string') ? value : undefined;
		};
		const defaultValue = key => config.inspect(key).defaultValue;
		const squiggly = setColors('squigglyBracketsColor');
		const isolated = config.get('isolatedRightBracketsColor');
		this.colors = {
			round: setColors('roundBracketsColor') || defaultValue('roundBracketsColor'),
			square: setColors('squareBracketsColor') || defaultValue('squareBracketsColor'),
			squiggly: squiggly || defaultValue('squigglyBracketsColor'),
			isolated: typeof isolated === 'string' ? isolated : defaultValue('isolatedRightBracketsColor'),
		};
		const create = options => vscode.window.createTextEditorDecorationType({ ...options, rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed });
		for (const type of this.decorationTypes) {
			type.dispose();
		}
		// Disposing the decoration types removed their decorations.
		this.windows = new WeakMap();
		this.decorationTypes = [
			...this.colors.round.map(color => create({ color })),
			...this.colors.square.map(color => create({ color })),
			...this.colors.squiggly.map((color, i) => create(i === 0 && !squiggly ? THEMED_SQUIGGLY : { color })),
			create({ color: this.colors.isolated }),
		];
		this.colorCounts = [this.colors.round.length, this.colors.square.length, this.colors.squiggly.length];
		this.firstSlot = [0, this.colorCounts[0], this.colorCounts[0] + this.colorCounts[1]];
		this.isolatedSlot = this.decorationTypes.length - 1;
		const excluded = config.get('excludedLanguageIds');
		this.excluded = new Set(Array.isArray(excluded) ? excluded : []);
		this.ignoreStringsAndComments = config.get('ignoreStringsAndComments') !== false;
	}

	onDidChangeConfiguration(event) {
		const affects = section => event.affectsConfiguration(section);
		if (['rainbowBrackets.ignoreStringsAndComments', 'editor.maxTokenizationLineLength', 'editor.largeFileOptimizations'].some(affects)) {
			this.generation++;
		}
		if (['rainbowBrackets', 'editor.maxTokenizationLineLength', 'editor.largeFileOptimizations'].some(affects)) {
			this.readConfiguration();
			this.refreshAll();
		}
	}

	onDidChangeTextDocument({ document, contentChanges }) {
		const state = this.documents.get(document.uri.toString());
		if (!state || contentChanges.length === 0) {
			return;
		}
		if (state.model) {
			state.model.applyChanges(contentChanges);
		}
		state.version++;
		this.refresh(document, EDIT_DELAY);
	}

	isExcluded(document) {
		// Output channels change all the time and aren't code.
		return this.excluded.has(document.languageId) || document.uri.scheme === 'output';
	}

	editorsOf(document) {
		return vscode.window.visibleTextEditors.filter(editor => editor.document === document);
	}

	refreshAll() {
		for (const document of new Set(vscode.window.visibleTextEditors.map(editor => editor.document))) {
			this.refresh(document);
		}
	}

	/** Brings the colors of a visible document up to date, after `delay` ms. */
	refresh(document, delay = 0) {
		const editors = this.editorsOf(document);
		if (this.disposed || editors.length === 0) {
			return;
		}
		const key = document.uri.toString();
		if (this.isExcluded(document)) {
			this.forget(key);
			editors.forEach(editor => this.clear(editor));
			return;
		}
		let state = this.documents.get(key);
		if (!state || state.document !== document) {
			// `version` counts the changes to the brackets that are not decorated yet.
			state = { key, document, model: null, generation: -1, version: 0, timer: undefined, running: null, again: false };
			this.documents.set(key, state);
		}
		clearTimeout(state.timer);
		state.timer = setTimeout(() => this.run(state), delay);
	}

	/** Stops the work on a document. */
	forget(key) {
		const state = this.documents.get(key);
		if (state) {
			clearTimeout(state.timer);
			this.documents.delete(key);
		}
	}

	/** Whether the work on a document should go on. */
	isCurrent(state) {
		return !this.disposed && !state.document.isClosed && this.documents.get(state.key) === state;
	}

	run(state) {
		clearTimeout(state.timer);
		state.timer = undefined;
		if (state.running) {
			state.again = true;
		} else {
			state.running = (async () => {
				try {
					do {
						state.again = false;
						await this.update(state);
					} while (state.again && this.isCurrent(state));
				} catch (error) {
					console.error('Rainbow Brackets 2:', error);
				} finally {
					state.running = null;
				}
			})();
		}
		return state.running;
	}

	async update(state) {
		const { document } = state;
		if (!this.isCurrent(state)) {
			return;
		}
		if (!state.model || state.generation !== this.generation || state.model.lineCount !== document.lineCount) {
			const generation = this.generation;
			const tokenizer = await this.tokenizerFor(document);
			if (!this.isCurrent(state)) {
				return;
			}
			if (generation !== this.generation) {
				state.again = true;
				return;
			}
			state.model = new DocumentModel(tokenizer, document.lineCount);
			state.generation = generation;
			state.version++;
		}
		// Lines that are scanned already are decorated while the rest is scanned. The colors of a
		// line depend only on the lines above it, so they are final.
		while (!state.model.update(document, Date.now() + SLICE)) {
			this.decorateAll(state);
			await new Promise(resolve => setImmediate(resolve));
			if (!this.isCurrent(state)) {
				return;
			}
			if (state.generation !== this.generation) {
				state.again = true;
				return;
			}
		}
		this.decorateAll(state);
	}

	async tokenizerFor(document) {
		if (!this.ignoreStringsAndComments) {
			return plainTokenizer;
		}
		const config = vscode.workspace.getConfiguration('editor', document);
		// VS Code doesn't highlight large files either.
		if (config.get('largeFileOptimizations', true) && (document.lineCount > 300000 || document.offsetAt(document.lineAt(document.lineCount - 1).range.end) > 20 * 1024 * 1024)) {
			return plainTokenizer;
		}
		return await this.grammars.getTokenizer(document.languageId, config.get('maxTokenizationLineLength', 20000)) || plainTokenizer;
	}

	decorateAll(state) {
		for (const editor of this.editorsOf(state.document)) {
			this.decorate(state, editor);
		}
	}

	/**
	 * Decorates the brackets around the visible lines, as far as they are up to date. Does nothing
	 * if they are decorated already, or if some visible line is not up to date: VS Code moves the
	 * existing decorations along with edits until then.
	 */
	decorate(state, editor) {
		const { model } = state;
		const ready = model.readyLines;
		const { first, last } = visibleLines(editor, model.lineCount);
		if (last >= ready) {
			return;
		}
		const window = this.windows.get(editor);
		if (window && window.version === state.version && window.start <= Math.max(0, first - MARGIN / 2) && Math.min(ready, last + 1 + MARGIN / 2) <= window.end) {
			return;
		}
		const start = Math.max(0, first - MARGIN), end = Math.min(ready, last + 1 + MARGIN);
		const ranges = this.decorationTypes.map(() => []);
		for (let line = start; line < end; line++) {
			const brackets = model.brackets[line];
			if (brackets.length === 0) {
				continue;
			}
			lineColors(brackets, model.depths[line], this.colorCounts).forEach((color, i) => {
				const code = brackets[i] % 8, column = (brackets[i] - code) / 8;
				const slot = color === ISOLATED ? this.isolatedSlot : this.firstSlot[code >> 1] + color;
				ranges[slot].push(new vscode.Range(line, column, line, column + 1));
			});
		}
		this.decorationTypes.forEach((type, slot) => editor.setDecorations(type, ranges[slot]));
		this.windows.set(editor, { start, end, version: state.version });
	}

	clear(editor) {
		if (this.windows.has(editor)) {
			this.decorationTypes.forEach(type => editor.setDecorations(type, []));
			this.windows.delete(editor);
		}
	}

	/**
	 * For the tests: the brackets of a visible document once they are up to date, as
	 * `{ line, character, bracket, color }`. The color is the index in the colors of its kind, or 'isolated'.
	 */
	async bracketColors(document) {
		this.refresh(document);
		const state = this.documents.get(document.uri.toString());
		if (!state) {
			return [];
		}
		while (state.timer !== undefined || state.running) {
			await (state.timer !== undefined ? this.run(state) : state.running);
		}
		if (!this.isCurrent(state) || !state.model || state.model.readyLines < state.model.lineCount) {
			return [];
		}
		const { model } = state;
		const result = [];
		model.brackets.forEach((brackets, line) => lineColors(brackets, model.depths[line], this.colorCounts).forEach((color, i) => {
			const code = brackets[i] % 8;
			result.push({ line, character: (brackets[i] - code) / 8, bracket: BRACKETS[code], color: color === ISOLATED ? 'isolated' : color });
		}));
		return result;
	}

	dispose() {
		this.disposed = true;
		for (const disposable of [...this.disposables, ...this.decorationTypes]) {
			disposable.dispose();
		}
		for (const key of [...this.documents.keys()]) {
			this.forget(key);
		}
		this.grammars.dispose();
	}
}

/**
 * The first and last visible lines of an editor. Right after lines are deleted, the visible
 * ranges can still reach past the end of the document.
 */
function visibleLines(editor, lineCount) {
	const visible = editor.visibleRanges;
	if (visible.length === 0) {
		return { first: 0, last: 0 };
	}
	const last = Math.min(visible[visible.length - 1].end.line, lineCount - 1);
	return { first: Math.min(visible[0].start.line, last), last };
}

/** Whether a setting has a value of its own in any scope. */
function isSet(inspection) {
	return ['globalValue', 'workspaceValue', 'workspaceFolderValue', 'globalLanguageValue', 'workspaceLanguageValue', 'workspaceFolderLanguageValue']
		.some(key => inspection[key] !== undefined);
}

function activate(context) {
	const rainbowBrackets = new RainbowBrackets();
	context.subscriptions.push(rainbowBrackets);
	return {
		bracketColors: document => rainbowBrackets.bracketColors(document),
		colors: () => rainbowBrackets.colors,
	};
}
exports.activate = activate;
function deactivate() {
}
exports.deactivate = deactivate;
