'use strict';

// A bracket is stored as one number: column * 8 + its index in BRACKETS. Even indexes are
// opening brackets, and index >> 1 is the kind of bracket (0 round, 1 square, 2 squiggly).
const BRACKETS = '()[]{}';
const ISOLATED = -1;
// Shared by the lines without brackets.
const NONE = Object.freeze([]);
// The depths of round, square and squiggly brackets at the start of a document.
const ZERO_DEPTHS = Object.freeze([0, 0, 0]);

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
 * The depths after a line with `brackets` that starts at `depths`, or `depths` itself if they don't change.
 * A closing bracket with no open bracket of its kind leaves the depth alone.
 */
function depthsAfter(brackets, depths) {
	if (brackets.length === 0) {
		return depths;
	}
	const after = depths.slice();
	for (const bracket of brackets) {
		const code = bracket % 8, kind = code >> 1;
		if ((code & 1) === 0) {
			after[kind]++;
		} else if (after[kind] > 0) {
			after[kind]--;
		}
	}
	return equalDepths(after, depths) ? depths : after;
}

function equalDepths(a, b) {
	return a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

/**
 * The colors of a line's brackets, given the depths at its start. Each kind of bracket has its own
 * colors: an opening bracket gets the color of its depth among the brackets of its kind, its closing
 * bracket gets the same color, and a closing bracket with no open bracket of its kind is ISOLATED.
 */
function lineColors(brackets, depths, colorCounts) {
	const depth = depths.slice();
	return brackets.map(bracket => {
		const code = bracket % 8, kind = code >> 1;
		if ((code & 1) === 0) {
			return depth[kind]++ % colorCounts[kind];
		}
		return depth[kind] > 0 ? --depth[kind] % colorCounts[kind] : ISOLATED;
	});
}

/** The colors of the brackets of a whole document, given line by line. */
function colorBrackets(lines, colorCounts) {
	let depths = ZERO_DEPTHS;
	return lines.map(brackets => {
		const colors = lineColors(brackets, depths, colorCounts);
		depths = depthsAfter(brackets, depths);
		return colors;
	});
}

module.exports = { BRACKETS, ISOLATED, NONE, ZERO_DEPTHS, scanBrackets, depthsAfter, equalDepths, lineColors, colorBrackets };
