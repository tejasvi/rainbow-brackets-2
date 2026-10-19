const assert = require('assert');
const path = require('path');
const { BRACKETS } = require('../../src/brackets');
const { DocumentModel } = require('../../src/documentModel');
const { GrammarStore, grammarTokenizer } = require('../../src/grammars');

const fixtures = path.join(__dirname, '..', 'fixtures', 'grammars');

function miniStore() {
	return new GrammarStore([{ extensionPath: fixtures, packageJSON: require(path.join(fixtures, 'package.json')) }]);
}

/** The brackets that count, line by line, as strings like '(@3'. */
function brackets(tokenizer, text) {
	const lines = text.split('\n');
	const model = new DocumentModel(tokenizer, lines.length);
	model.update({ lineAt: i => ({ text: lines[i] }) }, Infinity);
	return model.brackets.map(line => line.map(b => `${BRACKETS[b % 8]}@${Math.floor(b / 8)}`).join(' '));
}

suite('GrammarStore', () => {
	let store, tokenizer;
	const errors = [];
	let consoleError;
	suiteSetup(async () => {
		// The fixtures inject a grammar whose file is missing, which gets reported.
		consoleError = console.error;
		console.error = (...args) => errors.push(args.join(' '));
		store = miniStore();
		tokenizer = await store.getTokenizer('mini', 20000);
	});
	suiteTeardown(() => {
		console.error = consoleError;
		store.dispose();
	});

	test('brackets in strings, comments and regular expressions are skipped (#10)', () => {
		assert.deepStrictEqual(brackets(tokenizer, 'f("(" + "[[") // (\ng(~[(]~)'), ['(@1 )@12', '(@1 )@7']);
	});

	test('block comments and strings carry over to the next lines', () => {
		assert.deepStrictEqual(brackets(tokenizer, 'a( /* (\n ) */ )\n`${ {x} }\n(`)'),
			['(@1', ')@6', '{@2 {@4 }@6 }@8', ')@2']);
	});

	test('token types of the grammar contribution apply', () => {
		// The template expression is code, through "tokenTypes".
		assert.deepStrictEqual(brackets(tokenizer, '`(${ f(1) })`'), ['{@3 (@6 )@8 }@10']);
	});

	test('unbalanced bracket scopes of the grammar contribution are skipped', () => {
		assert.deepStrictEqual(brackets(tokenizer, '(:))'), ['(@0 )@3']);
	});

	test('injected grammars apply, even with a byte order mark, and a missing one is skipped', () => {
		// The injection makes `@see(...)` code inside line comments.
		assert.deepStrictEqual(brackets(tokenizer, '// @see(x) (y)'), ['(@7 )@9']);
		assert.ok(errors.some(error => error.includes('missing.tmLanguage.json')), errors.join('\n'));
	});

	test('like in VS Code, lines longer than editor.maxTokenizationLineLength have no brackets and keep the state', async () => {
		const short = await store.getTokenizer('mini', 10);
		// The third line is still in the comment opened on the first one.
		assert.deepStrictEqual(brackets(short, '/* (\n*/ "(" (x)\n(y)*/(z)'), ['', '', '(@5 )@7']);
	});

	test('like in VS Code, patterns that Oniguruma cannot compile never match', () => {
		// Inside << >> the grammar has an invalid pattern next to the end pattern, so the block never ends.
		assert.deepStrictEqual(brackets(tokenizer, '(\nf(<<x>>)\n)'), ['(@0', '(@1 )@7', ')@0']);
	});

	test('a line that the grammar throws on has no brackets and keeps the state', () => {
		const grammar = {
			tokenizeLine2(text, state) {
				if (text.includes('!')) {
					throw new Error('cannot tokenize');
				}
				return { tokens: new Uint32Array([0, 1 << 10]), ruleStack: state, stoppedEarly: false };
			},
		};
		const state = { equals: other => other === state };
		assert.deepStrictEqual(brackets(grammarTokenizer(grammar, state, 20000), '(\n!()\n)'), ['(@0', '', ')@0']);
		assert.ok(errors.some(error => error.includes('cannot tokenize a line')), errors.join('\n'));
	});

	test('languages without a grammar have no tokenizer', async () => {
		assert.strictEqual(await store.getTokenizer('plaintext', 20000), null);
	});
});
