const assert = require('assert');
const { BRACKETS, ISOLATED, scanBrackets, colorBrackets } = require('../../src/brackets');

/** Colors `text` and writes each bracket followed by its color, or by `!` when it is isolated. */
function colors(text, colorCounts = [4, 3, 3]) {
	const lines = text.split('\n').map(line => scanBrackets(line, 0, line.length, []));
	return colorBrackets(lines, colorCounts).map((lineColors, i) => lineColors
		.map((color, k) => BRACKETS[lines[i][k] % 8] + (color === ISOLATED ? '!' : color))
		.join(' '));
}

suite('colorBrackets', () => {
	test('closing brackets get the color of their opening bracket, also the first color (#6, #7, #9)', () => {
		assert.deepStrictEqual(colors('{\n  "manuallyAddedMods": []\n}'), ['{0', '[0 ]0', '}0']);
		assert.deepStrictEqual(colors('object HelloScala2 extends App {\n  println("Hello Scala2")\n}'), ['{0', '(0 )0', '}0']);
		assert.deepStrictEqual(colors('module m(\n  reg [7:0] cnt;\n);'), ['(0', '[0 ]0', ')0']);
	});

	test('each kind of bracket has its own depth', () => {
		assert.deepStrictEqual(colors('{ a[(b[c])] }'), ['{0 [0 (0 [1 ]1 )0 ]0 }0']);
	});

	test('colors repeat after the last one', () => {
		assert.deepStrictEqual(colors('((((()))))', [2, 1, 1]), ['(0 (1 (0 (1 (0 )0 )1 )0 )1 )0']);
	});

	test('brackets at the same depth get the same color', () => {
		assert.deepStrictEqual(colors('f(a)(b) g((c), (d))'), ['(0 )0 (0 )0 (0 (1 )1 (1 )1 )0']);
	});

	test('closing brackets with no opening bracket are isolated and leave the depth alone', () => {
		assert.deepStrictEqual(colors(') ( ] ) )'), [')! (0 ]! )0 )!']);
	});

	test('positions are kept', () => {
		assert.deepStrictEqual(scanBrackets('a(b) [c]', 0, 8, []).map(b => [Math.floor(b / 8), BRACKETS[b % 8]]),
			[[1, '('], [3, ')'], [5, '['], [7, ']']]);
		assert.deepStrictEqual(scanBrackets('(((', 1, 2, []), [1 * 8 + 0]);
	});
});
