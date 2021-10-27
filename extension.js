/*
 * author: 2gua., tejasvi
 */
'use strict';
const vscode = require('vscode');
function activate(context) {
	vscode.window.onDidChangeActiveColorTheme(() => {
		deactivate();
		for (let sub of context.subscriptions) {
			sub.dispose();
		}
		activate();
	}, null, context.subscriptions);

	const config = vscode.workspace.getConfiguration("rainbowBrackets");

	const roundBracketsColor = config.get("roundBracketsColor", ["#e6b422", "#c70067", "#00a960", "#fc7482"]);
	const squareBracketsColor = config.get("squareBracketsColor", ["#33ccff", "#8080ff", "#0073a8"]);
	const squigglyBracketsColor = config.get("squigglyBracketsColor", [vscode.window.activeColorTheme.kind == vscode.ColorThemeKind.Dark ? "#d4d4aa" : "#484c61", "#d1a075", "#9c6628"]);

	const roundBracketsDecorationTypes = [];
	const squareBracketsDecorationTypes = [];
	const squigglyBracketsDecorationTypes = [];
	for (let index in roundBracketsColor) {
		roundBracketsDecorationTypes.push(vscode.window.createTextEditorDecorationType({
			color: roundBracketsColor[index]
		}));
	}
	for (let index in squareBracketsColor) {
		squareBracketsDecorationTypes.push(vscode.window.createTextEditorDecorationType({
			color: squareBracketsColor[index]
		}));
	}
	for (let index in squigglyBracketsColor) {
		squigglyBracketsDecorationTypes.push(vscode.window.createTextEditorDecorationType({
			color: squigglyBracketsColor[index]
		}));
	}

	const excludedLanguageIdsSet = new Set(config.get("excludedLanguageIds", []));

	let activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		if (excludedLanguageIdsSet.has(activeEditor.document.languageId)) {
			activeEditor = undefined;
		} else {
			rainbowBrackets();
		}
	}
	vscode.window.onDidChangeActiveTextEditor(function (editor) {
		if (editor && !excludedLanguageIdsSet.has(editor.document.languageId)) {
			activeEditor = editor;
			rainbowBrackets();
		} else {
			activeEditor = undefined;
		}
	}, null, context.subscriptions);
	vscode.workspace.onDidChangeTextDocument(function (event) {
		if (activeEditor && event.document === activeEditor.document) {
			rainbowBrackets();
		}
	}, null, context.subscriptions);
	function rainbowBrackets() {
		if (!activeEditor) {
			return;
		}
		const text = activeEditor.document.getText();
		const regEx = /[\(\)\[\]\{\}]/g;
		let match;
		let roundBracketsColorCount = 0;
		let squareBracketsColorCount = 0;
		let squigglyBracketsColorCount = 0;
		const leftRoundBracketsStack = [];
		const leftSquareBracketsStack = [];
		const leftSquigglyBracketsStack = [];
		const roundBracketsDecorationTypeMap = {};
		const squareBracketsDecorationTypeMap = {};
		const squigglyBracketsDecorationTypeMap = {};
		for (let index in roundBracketsDecorationTypes) {
			roundBracketsDecorationTypeMap[index] = [];
		}
		;
		for (let index in squareBracketsDecorationTypes) {
			squareBracketsDecorationTypeMap[index] = [];
		}
		;
		for (let index in squigglyBracketsDecorationTypes) {
			squigglyBracketsDecorationTypeMap[index] = [];
		}
		;
		const rightBracketsDecorationTypes = [];
		let roundCalculate;
		let squareCalculate;
		let squigglyCalculate;
		while (match = regEx.exec(text)) {
			const startPos = activeEditor.document.positionAt(match.index);
			const endPos = activeEditor.document.positionAt(match.index + 1);
			const decoration = new vscode.Range(startPos, endPos);
			switch (match[0]) {
				case '(':
					roundCalculate = roundBracketsColorCount;
					leftRoundBracketsStack.push(roundCalculate);
					roundBracketsColorCount++;
					if (roundBracketsColorCount >= roundBracketsColor.length) {
						roundBracketsColorCount = 0;
					}
					roundBracketsDecorationTypeMap[roundCalculate].push(decoration);
					break;
				case ')':
					if ((roundCalculate = leftRoundBracketsStack.pop())) {
						roundBracketsColorCount = roundCalculate;
						roundBracketsDecorationTypeMap[roundCalculate].push(decoration);
					}
					else {
						rightBracketsDecorationTypes.push(decoration);
					}
					break;
				case '[':
					squareCalculate = squareBracketsColorCount;
					leftSquareBracketsStack.push(squareCalculate);
					squareBracketsColorCount++;
					if (squareBracketsColorCount >= squareBracketsColor.length) {
						squareBracketsColorCount = 0;
					}
					squareBracketsDecorationTypeMap[squareCalculate].push(decoration);
					break;
				case ']':
					if ((squareCalculate = leftSquareBracketsStack.pop())) {
						squareBracketsColorCount = squareCalculate;
						squareBracketsDecorationTypeMap[squareCalculate].push(decoration);
					}
					else {
						rightBracketsDecorationTypes.push(decoration);
					}
					break;
				case '{':
					squigglyCalculate = squigglyBracketsColorCount;
					leftSquigglyBracketsStack.push(squigglyCalculate);
					squigglyBracketsColorCount++;
					if (squigglyBracketsColorCount >= squigglyBracketsColor.length) {
						squigglyBracketsColorCount = 0;
					}
					squigglyBracketsDecorationTypeMap[squigglyCalculate].push(decoration);
					break;
				case '}':
					if ((squigglyCalculate = leftSquigglyBracketsStack.pop())) {
						squigglyBracketsColorCount = squigglyCalculate;
						squigglyBracketsDecorationTypeMap[squigglyCalculate].push(decoration);
					}
					else {
						rightBracketsDecorationTypes.push(decoration);
					}
					break;
				default:
			}
		}
		for (let index in roundBracketsDecorationTypes) {
			activeEditor.setDecorations(roundBracketsDecorationTypes[index], roundBracketsDecorationTypeMap[index]);
		}
		for (let index in squareBracketsDecorationTypes) {
			activeEditor.setDecorations(squareBracketsDecorationTypes[index], squareBracketsDecorationTypeMap[index]);
		}
		for (let index in squigglyBracketsDecorationTypes) {
			activeEditor.setDecorations(squigglyBracketsDecorationTypes[index], squigglyBracketsDecorationTypeMap[index]);
		}
	}
}
exports.activate = activate;
function deactivate() {
}
exports.deactivate = deactivate;
