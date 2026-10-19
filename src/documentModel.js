'use strict';
const { NONE, ZERO_DEPTHS, scanBrackets, depthsAfter, equalDepths } = require('./brackets');

function allBrackets(text) {
	const brackets = scanBrackets(text, 0, text.length, []);
	return brackets.length > 0 ? brackets : NONE;
}

/** Counts every bracket. Used for languages without a grammar. */
const plainTokenizer = {
	initialState: null,
	tokenizeLine: (text, state) => ({ brackets: allBrackets(text), state }),
	equalStates: () => true,
};

/**
 * The brackets of a document line by line, and the bracket depths at the start of each line.
 * After an edit, lines are scanned again from the first edited line until one ends in the same
 * tokenizer state as before, and their depths are counted again until a line ends at the same
 * depths as before: the lines after it are unchanged.
 */
class DocumentModel {
	constructor(tokenizer, lineCount) {
		this.tokenizer = tokenizer;
		// The brackets of each line, or null when the line has to be scanned.
		this.brackets = new Array(lineCount).fill(null);
		// The tokenizer state at the start of each line. A null state is set before the line is scanned.
		this.states = new Array(lineCount).fill(null);
		this.states[0] = tokenizer.initialState;
		// No line before this one has to be scanned.
		this.firstDirty = 0;
		// Whether each line has been counted since its brackets or the depths at its start changed.
		this.counted = new Array(lineCount).fill(false);
		// The bracket depths at the start of each line. A null depth is set before the line is counted.
		this.depths = new Array(lineCount).fill(null);
		this.depths[0] = ZERO_DEPTHS;
		// No line before this one has to be counted.
		this.firstUncounted = 0;
	}

	get lineCount() {
		return this.brackets.length;
	}

	/** The number of lines at the top whose brackets and depths are up to date. */
	get readyLines() {
		return Math.min(this.firstDirty, this.firstUncounted);
	}

	/** Follows the `contentChanges` of a text document change event. */
	applyChanges(changes) {
		// Each change applies to the text left by the changes before it.
		for (const { range, text } of changes) {
			const start = range.start.line, end = range.end.line;
			const added = countLineBreaks(text);
			this.brackets = splice(this.brackets, start, end - start + 1, added + 1, null);
			this.counted = splice(this.counted, start, end - start + 1, added + 1, false);
			// The state and the depths at the start of the first edited line stay right. The ones after the
			// edit are kept, so that scanning and counting can stop at a line that still ends as before.
			this.states = splice(this.states, start + 1, end - start, added, null);
			this.depths = splice(this.depths, start + 1, end - start, added, null);
			this.firstDirty = Math.min(this.firstDirty, start);
			this.firstUncounted = Math.min(this.firstUncounted, start);
		}
	}

	/**
	 * Scans the lines that need it and counts the depths of the scanned lines, until the `deadline`
	 * (in Date.now() time). Returns whether every line is up to date.
	 */
	update(document, deadline) {
		this.scan(document, deadline);
		this.count(deadline);
		return this.readyLines >= this.lineCount;
	}

	scan(document, deadline) {
		const { brackets, states, counted, tokenizer } = this;
		const lineCount = brackets.length;
		let line = this.firstDirty;
		this.firstUncounted = Math.min(this.firstUncounted, line);
		while (line < lineCount) {
			const result = tokenizer.tokenizeLine(document.lineAt(line).text, states[line]);
			brackets[line] = result.brackets;
			counted[line++] = false;
			if (line === lineCount) {
				break;
			}
			if (brackets[line] !== null && tokenizer.equalStates(result.state, states[line])) {
				// The lines up to the next one to scan are unchanged.
				line = brackets.indexOf(null, line);
				if (line === -1) {
					line = lineCount;
				}
			} else {
				states[line] = result.state;
				// The line starts in a new state, so it has to be scanned, even if an edit comes first.
				brackets[line] = null;
				counted[line] = false;
			}
			if (Date.now() >= deadline) {
				break;
			}
		}
		this.firstDirty = line;
	}

	/** Counts the depths of the scanned lines that need it. */
	count(deadline) {
		const { brackets, depths, counted } = this;
		const lineCount = brackets.length, scanned = this.firstDirty;
		let line = this.firstUncounted, steps = 0;
		while (line < scanned) {
			// Counting is fast: look at the clock only now and then.
			if ((++steps & 4095) === 0 && Date.now() >= deadline) {
				break;
			}
			const after = depthsAfter(brackets[line], depths[line]);
			counted[line++] = true;
			if (line === lineCount) {
				break;
			}
			if (counted[line] && equalDepths(after, depths[line])) {
				// The depths are right up to the next line to count.
				line = counted.indexOf(false, line);
				if (line === -1) {
					line = lineCount;
				}
			} else {
				depths[line] = after;
				counted[line] = false;
			}
		}
		this.firstUncounted = line;
	}
}

function countLineBreaks(text) {
	const breaks = text.match(/\r\n|\r|\n/g);
	return breaks ? breaks.length : 0;
}

/** Replaces `deleteCount` items at `start` with `insertCount` copies of `value`. Large edits get a new array. */
function splice(array, start, deleteCount, insertCount, value) {
	if (insertCount < 10000) {
		array.splice(start, deleteCount, ...new Array(insertCount).fill(value));
		return array;
	}
	return array.slice(0, start).concat(new Array(insertCount).fill(value), array.slice(start + deleteCount));
}

module.exports = { DocumentModel, plainTokenizer };
