'use strict';
const { NONE, scanBrackets } = require('./brackets');

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
 * The brackets of a document, line by line. After an edit, lines are scanned again from the first
 * edited line until one ends in the same tokenizer state as before: the lines after it are unchanged.
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
	}

	get lineCount() {
		return this.brackets.length;
	}

	/** Follows the `contentChanges` of a text document change event. */
	applyChanges(changes) {
		// Each change applies to the text left by the changes before it.
		for (const { range, text } of changes) {
			const start = range.start.line, end = range.end.line;
			const added = countLineBreaks(text);
			this.brackets = splice(this.brackets, start, end - start + 1, added + 1);
			// The state at the start of the first edited line stays right. The states after the edit
			// are kept so that scanning can stop at a line that still ends in the old state.
			this.states = splice(this.states, start + 1, end - start, added);
			this.firstDirty = Math.min(this.firstDirty, start);
		}
	}

	/** Scans the lines that need it, until the `deadline` (in Date.now() time). Returns whether all are done. */
	update(document, deadline) {
		const { brackets, states, tokenizer } = this;
		const lineCount = brackets.length;
		let line = this.firstDirty;
		while (line < lineCount) {
			const result = tokenizer.tokenizeLine(document.lineAt(line).text, states[line]);
			brackets[line++] = result.brackets;
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
			}
			if (Date.now() >= deadline) {
				break;
			}
		}
		this.firstDirty = line;
		return line >= lineCount;
	}
}

function countLineBreaks(text) {
	const breaks = text.match(/\r\n|\r|\n/g);
	return breaks ? breaks.length : 0;
}

/** Replaces `deleteCount` items at `start` with `insertCount` nulls. Large edits get a new array. */
function splice(array, start, deleteCount, insertCount) {
	if (insertCount < 10000) {
		array.splice(start, deleteCount, ...new Array(insertCount).fill(null));
		return array;
	}
	return array.slice(0, start).concat(new Array(insertCount).fill(null), array.slice(start + deleteCount));
}

module.exports = { DocumentModel, plainTokenizer };
