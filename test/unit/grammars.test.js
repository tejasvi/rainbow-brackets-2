const assert = require('assert');
const path = require('path');
const { BRACKETS } = require('../../src/brackets');
const { DocumentModel } = require('../../src/documentModel');
const { GrammarStore } = require('../../src/grammars');

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
	suiteSetup(async () => {
		store = miniStore();
		tokenizer = await store.getTokenizer('mini', 20000);
	});
	suiteTeardown(() => store.dispose());

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

	test('injected grammars apply', () => {
		// The injection makes `@see(...)` code inside line comments.
		assert.deepStrictEqual(brackets(tokenizer, '// @see(x) (y)'), ['(@7 )@9']);
	});

	test('in lines longer than editor.maxTokenizationLineLength every bracket counts and the state carries over', async () => {
		const short = await store.getTokenizer('mini', 10);
		// The second line is still in the comment opened on the first one.
		assert.deepStrictEqual(brackets(short, '/* (\n*/ "(" (x)\n(y)*/(z)'), ['', '(@4 (@7 )@9', '(@5 )@7']);
	});

	test('languages without a grammar have no tokenizer', async () => {
		assert.strictEqual(await store.getTokenizer('plaintext', 20000), null);
	});
});
