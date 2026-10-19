const assert = require('assert');
const path = require('path');
const { DocumentModel, plainTokenizer } = require('../../src/documentModel');
const { GrammarStore } = require('../../src/grammars');

const fixtures = path.join(__dirname, '..', 'fixtures', 'grammars');

/** A document with the parts of vscode.TextDocument that DocumentModel uses. */
function documentOf(text) {
	const lines = text.split('\n');
	return { lineCount: lines.length, lineAt: i => ({ text: lines[i] }) };
}

function scanned(tokenizer, text) {
	const document = documentOf(text);
	const model = new DocumentModel(tokenizer, document.lineCount);
	model.update(document, Infinity);
	return model;
}

/** The brackets and depths of the first `count` lines, to compare models. */
function lines(model, count = model.lineCount) {
	return model.brackets.slice(0, count).map((brackets, i) => ({ brackets, depths: [...model.depths[i]] }));
}

function offsetOf(text, line, character) {
	const lines = text.split('\n');
	return lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + character;
}

/** A random position in `text` as { line, character }. */
function randomPosition(text, random) {
	const lines = text.split('\n');
	const line = Math.floor(random() * lines.length);
	return { line, character: Math.floor(random() * (lines[line].length + 1)) };
}

function before(a, b) {
	return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

// Deterministic, so that a failure can be replayed.
function mulberry32(seed) {
	return () => {
		seed |= 0;
		seed = seed + 0x6D2B79F5 | 0;
		let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

const PIECES = ['(', ')', '[', ']', '{', '}', '"', '`', '${', '/*', '*/', '//', '~', ':)', '\\', '\n', '\n', 'x', ' ', 'ab'];

function randomText(random, length) {
	let text = '';
	for (let i = 0; i < length; i++) {
		text += PIECES[Math.floor(random() * PIECES.length)];
	}
	return text;
}

/**
 * Edits random documents with events of up to three changes, each applying to the text left by the
 * changes before it, as in VS Code. Scans after some of the events, sometimes only partly, and checks
 * that the brackets are the same as when the final text is scanned from scratch.
 */
function fuzz(tokenizer, seed) {
	const random = mulberry32(seed);
	let text = randomText(random, 40);
	let document = documentOf(text);
	const model = new DocumentModel(tokenizer, document.lineCount);
	model.update(document, Infinity);
	for (let step = 0; step < 300; step++) {
		const changes = [];
		const count = 1 + Math.floor(random() * 3);
		for (let c = 0; c < count; c++) {
			let start = randomPosition(text, random), end = randomPosition(text, random);
			if (!before(start, end)) {
				[start, end] = [end, start];
			}
			if (random() < 0.5) {
				end = start;
			}
			const inserted = random() < 0.2 ? '' : randomText(random, 1 + Math.floor(random() * 6));
			changes.push({ range: { start, end }, text: inserted });
			text = text.slice(0, offsetOf(text, start.line, start.character)) + inserted + text.slice(offsetOf(text, end.line, end.character));
		}
		model.applyChanges(changes);
		document = documentOf(text);
		const r = random();
		if (r < 0.3) {
			model.update(document, Infinity);
		} else if (r < 0.6) {
			// Only part of the lines get scanned before the next edit.
			model.update(document, 0);
		}
		if (step % 10 === 9) {
			assert.strictEqual(model.update(document, Infinity), true);
			assert.deepStrictEqual(lines(model), lines(scanned(tokenizer, text)), `seed ${seed}, step ${step}, text ${JSON.stringify(text)}`);
		} else if (model.readyLines < model.lineCount) {
			// The lines reported ready are right already.
			const ready = model.readyLines;
			assert.deepStrictEqual(lines(model, ready), lines(scanned(tokenizer, text), ready), `seed ${seed}, step ${step}`);
		}
	}
}

suite('DocumentModel', () => {
	let store, grammarTokenizer;
	const errors = [];
	let consoleError;
	suiteSetup(async () => {
		// The fixtures inject a grammar whose file is missing, which gets reported.
		consoleError = console.error;
		console.error = (...args) => errors.push(args.join(' '));
		store = new GrammarStore([{ extensionPath: fixtures, packageJSON: require(path.join(fixtures, 'package.json')) }]);
		grammarTokenizer = await store.getTokenizer('mini', 20000);
	});
	suiteTeardown(() => {
		console.error = consoleError;
		store.dispose();
	});

	test('incremental scans match full scans, without a grammar', () => {
		for (let seed = 1; seed <= 30; seed++) {
			fuzz(plainTokenizer, seed);
		}
	});

	test('incremental scans match full scans, with a grammar', () => {
		for (let seed = 1; seed <= 30; seed++) {
			fuzz(grammarTokenizer, seed);
		}
	});

	test('scanning stops at the first line that ends as before', () => {
		const text = 'a(\n"b"\n/* c\n*/\nd)';
		const document = documentOf(text);
		const model = new DocumentModel(grammarTokenizer, document.lineCount);
		model.update(document, Infinity);
		const scannedLines = [];
		const tokenizeLine = grammarTokenizer.tokenizeLine;
		model.tokenizer = { ...grammarTokenizer, tokenizeLine: (line, state) => (scannedLines.push(line), tokenizeLine(line, state)) };
		// Editing the string doesn't change how the line ends.
		model.applyChanges([{ range: { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } }, text: '(' }]);
		model.update(documentOf('a(\n"b("\n/* c\n*/\nd)'), Infinity);
		assert.deepStrictEqual(scannedLines, ['"b("']);
		// Opening a comment changes the lines after it, up to one that was in a comment already.
		scannedLines.length = 0;
		model.applyChanges([{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, text: '/*' }]);
		model.update(documentOf('a(\n/*"b("\n/* c\n*/\nd)'), Infinity);
		assert.deepStrictEqual(scannedLines, ['/*"b("', '/* c']);
	});

	test('depths are counted again only until a line ends at the same depths as before', () => {
		const text = 'a(\nb\n)\nc\n(d)';
		const model = scanned(plainTokenizer, text);
		const depths = model.depths.slice();
		// A balanced edit leaves the depths of the lines after it alone.
		model.applyChanges([{ range: { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } }, text: '[x]' }]);
		model.update(documentOf('a(\nb[x]\n)\nc\n(d)'), Infinity);
		assert.deepStrictEqual(model.depths, depths);
		assert.ok(model.depths.every((d, i) => d === depths[i]));
		// An unbalanced one changes them up to the end.
		model.applyChanges([{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, text: '{' }]);
		model.update(documentOf('a(\n{b[x]\n)\nc\n(d)'), Infinity);
		assert.deepStrictEqual(model.depths.map(d => [...d]), [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 1]]);
	});

	test('counting stops at the deadline and goes on later', () => {
		const text = 'a\n' + '(\n'.repeat(10000);
		const model = scanned(plainTokenizer, text);
		// Every line after the edit gets a new square bracket depth.
		model.applyChanges([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: '[' }]);
		const document = documentOf('[' + text);
		const ready = [];
		while (!model.update(document, 0)) {
			ready.push(model.readyLines);
		}
		assert.ok(ready.length >= 2 && ready.every((r, i) => i === 0 || r > ready[i - 1]), ready.join());
		assert.deepStrictEqual(lines(model), lines(scanned(plainTokenizer, '[' + text)));
	});

	test('large pastes', () => {
		const pasted = '(\n'.repeat(30000);
		const model = new DocumentModel(plainTokenizer, 2);
		model.update(documentOf('a\n)'), Infinity);
		model.applyChanges([{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, text: pasted }]);
		const text = 'a\n' + pasted + ')';
		model.update(documentOf(text), Infinity);
		assert.strictEqual(model.lineCount, 30002);
		assert.deepStrictEqual(lines(model), lines(scanned(plainTokenizer, text)));
	});
});
