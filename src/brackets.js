'use strict';

// A bracket is stored as one number: column * 8 + its index in BRACKETS. Even indexes are
// opening brackets, and index >> 1 is the kind of bracket (0 round, 1 square, 2 squiggly).
const BRACKETS = '()[]{}';
const ISOLATED = -1;
// Shared by the lines without brackets.
const NONE = Object.freeze([]);

const codeOf = new Int8Array(128).fill(-1);
for (let i = 0; i < BRACKETS.length; i++) {
	codeOf[BRACKETS.charCodeAt(i)] = i;
}

/** Appends the brackets of `text` between `start` and `end` to `out`. */
function scanBrackets(text, start, end, out) {
	for (let i = start; i < end; i++) {
		const c = text.charCodeAt(i);
		if (c < 128 && codeOf[c] >= 0) {
			out.push(i * 8 + codeOf[c]);
		}
	}
	return out;
}

/**
 * Colors the brackets of a document, given line by line. Each kind of bracket has its own colors:
 * an opening bracket gets the color of its depth among the brackets of its kind, its closing
 * bracket gets the same color, and a closing bracket with no open bracket of its kind is ISOLATED.
 */
function colorBrackets(lines, colorCounts) {
	const depth = [0, 0, 0];
	return lines.map(brackets => brackets.map(bracket => {
		const code = bracket % 8, kind = code >> 1;
		if ((code & 1) === 0) {
			return depth[kind]++ % colorCounts[kind];
		}
		return depth[kind] > 0 ? --depth[kind] % colorCounts[kind] : ISOLATED;
	}));
}

module.exports = { BRACKETS, ISOLATED, NONE, scanBrackets, colorBrackets };
