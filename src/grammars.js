'use strict';
const fs = require('fs');
const path = require('path');
const { NONE, scanBrackets } = require('./brackets');

// In the token metadata of vscode-textmate, bits 8-9 hold the token type (0 other, 1 comment,
// 2 string, 3 regular expression) and bit 10 is set where brackets count as brackets.
const TOKEN_TYPE_MASK = 0b11 << 8;
const BALANCED_BRACKETS_MASK = 1 << 10;
const TOKEN_TYPES = { other: 0, comment: 1, string: 2, regex: 3 };
// VS Code stops tokenizing a line after 500 ms.
const TIME_LIMIT = 500;

let textmate;
let onigLib;

function loadTextmate() {
	if (!textmate) {
		textmate = require('vscode-textmate');
		// The same vscode-oniguruma as VS Code's, which never matches a pattern it can't compile
		// where newer versions throw. It can be loaded only once per process.
		const oniguruma = require('vscode-oniguruma');
		const wasm = fs.readFileSync(path.join(path.dirname(require.resolve('vscode-oniguruma')), 'onig.wasm'));
		onigLib = oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)).then(() => ({
			createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
			createOnigString: text => new oniguruma.OnigString(text),
		}));
	}
	return textmate;
}

/**
 * The TextMate grammars contributed by extensions, set up the way VS Code sets them up for
 * highlighting and for its own bracket pair colorization.
 */
class GrammarStore {
	/** `extensions` are like `vscode.extensions.all`: objects with `extensionPath` and `packageJSON`. */
	constructor(extensions) {
		this.byScope = new Map();
		this.scopeOfLanguage = new Map();
		this.injections = new Map();
		for (const extension of extensions) {
			const contributes = extension.packageJSON && extension.packageJSON.contributes;
			const grammars = contributes && contributes.grammars;
			if (!Array.isArray(grammars)) {
				continue;
			}
			for (const grammar of grammars) {
				if (!grammar || typeof grammar.scopeName !== 'string' || typeof grammar.path !== 'string') {
					continue;
				}
				this.byScope.set(grammar.scopeName, { ...grammar, path: path.join(extension.extensionPath, grammar.path) });
				if (typeof grammar.language === 'string') {
					this.scopeOfLanguage.set(grammar.language, grammar.scopeName);
				}
				for (const target of Array.isArray(grammar.injectTo) ? grammar.injectTo : []) {
					if (!this.injections.has(target)) {
						this.injections.set(target, []);
					}
					this.injections.get(target).push(grammar.scopeName);
				}
			}
		}
		this.registry = null;
		this.tokenizers = new Map();
	}

	/**
	 * A tokenizer for `DocumentModel` that finds the brackets the grammar of `languageId` puts in code,
	 * and not in strings, comments or regular expressions. Null if the language has no grammar.
	 */
	getTokenizer(languageId, maxLineLength) {
		const key = languageId + ' ' + maxLineLength;
		if (!this.tokenizers.has(key)) {
			this.tokenizers.set(key, this.loadGrammar(languageId).then(
				grammar => grammar && grammarTokenizer(grammar, textmate.INITIAL, maxLineLength),
				error => {
					console.error(`Rainbow Brackets 2: cannot load the grammar of ${languageId}`, error);
					return null;
				}));
		}
		return this.tokenizers.get(key);
	}

	async loadGrammar(languageId) {
		const scopeName = this.scopeOfLanguage.get(languageId);
		if (scopeName === undefined) {
			return null;
		}
		const grammar = this.byScope.get(scopeName);
		const tokenTypes = {};
		for (const [selector, type] of Object.entries(grammar.tokenTypes || {})) {
			if (type in TOKEN_TYPES) {
				tokenTypes[selector] = TOKEN_TYPES[type];
			}
		}
		return this.getRegistry().loadGrammarWithConfiguration(scopeName, 1, {
			tokenTypes,
			balancedBracketSelectors: stringArray(grammar.balancedBracketScopes, ['*']),
			unbalancedBracketSelectors: stringArray(grammar.unbalancedBracketScopes, []),
		});
	}

	getRegistry() {
		if (!this.registry) {
			const { Registry, parseRawGrammar } = loadTextmate();
			this.registry = new Registry({
				onigLib,
				loadGrammar: async scopeName => {
					const grammar = this.byScope.get(scopeName);
					if (!grammar) {
						return null;
					}
					// Like VS Code, go on without a grammar that can't be loaded, such as an injection.
					try {
						const content = await fs.promises.readFile(grammar.path, 'utf8');
						return parseRawGrammar(content.replace(/^\uFEFF/, ''), grammar.path);
					} catch (error) {
						console.error(`Rainbow Brackets 2: cannot load the grammar ${grammar.path}`, error);
						return null;
					}
				},
				getInjections: scopeName => {
					// Grammars injected into `source.js` apply to `source.js.jsx` too.
					const parts = scopeName.split('.');
					const injections = [];
					for (let i = 1; i <= parts.length; i++) {
						injections.push(...(this.injections.get(parts.slice(0, i).join('.')) || []));
					}
					return injections;
				},
			});
		}
		return this.registry;
	}

	dispose() {
		if (this.registry) {
			this.registry.dispose();
		}
	}
}

function stringArray(value, defaultValue) {
	return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : defaultValue;
}

function grammarTokenizer(grammar, initialState, maxLineLength) {
	let failed = false;
	return {
		initialState,
		tokenizeLine(text, state) {
			// Like VS Code, find no brackets in lines that are too long to tokenize or that the grammar
			// fails on, and keep the state across them.
			if (text.length >= maxLineLength) {
				return { brackets: NONE, state };
			}
			let result;
			try {
				result = grammar.tokenizeLine2(text, state, TIME_LIMIT);
			} catch (error) {
				if (!failed) {
					failed = true;
					console.error('Rainbow Brackets 2: cannot tokenize a line', error);
				}
				return { brackets: NONE, state };
			}
			const tokens = result.tokens, brackets = [];
			for (let i = 0; i < tokens.length; i += 2) {
				const metadata = tokens[i + 1];
				if ((metadata & TOKEN_TYPE_MASK) === 0 && (metadata & BALANCED_BRACKETS_MASK) !== 0) {
					scanBrackets(text, tokens[i], i + 2 < tokens.length ? tokens[i + 2] : text.length, brackets);
				}
			}
			// Like VS Code, keep the state of a line that took too long.
			return { brackets: brackets.length > 0 ? brackets : NONE, state: result.stoppedEarly ? state : result.ruleStack };
		},
		equalStates: (a, b) => a === b || a.equals(b),
	};
}

module.exports = { GrammarStore, grammarTokenizer };
