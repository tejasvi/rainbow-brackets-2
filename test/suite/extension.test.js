const assert = require('assert');
const vscode = require('vscode');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function api() {
	return vscode.extensions.getExtension('tejasvi.rainbow-brackets-2').activate();
}

async function show(language, content) {
	const document = await vscode.workspace.openTextDocument({ language, content });
	await vscode.window.showTextDocument(document);
	return document;
}

/** Each line's brackets followed by their color, or by `!` when they are isolated. */
async function colors(document) {
	const lines = Array.from({ length: document.lineCount }, () => []);
	for (const { line, bracket, color } of await (await api()).bracketColors(document)) {
		lines[line].push(bracket + (color === 'isolated' ? '!' : color));
	}
	return lines.map(line => line.join(' '));
}

async function edit(document, line, character, endLine, endCharacter, text) {
	const change = new vscode.WorkspaceEdit();
	change.replace(document.uri, new vscode.Range(line, character, endLine, endCharacter), text);
	assert.ok(await vscode.workspace.applyEdit(change));
}

async function setConfig(key, value) {
	await vscode.workspace.getConfiguration('rainbowBrackets').update(key, value, vscode.ConfigurationTarget.Global);
	await sleep(100);
}

suite('Rainbow Brackets 2', () => {
	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		for (const key of ['roundBracketsColor', 'squareBracketsColor', 'ignoreStringsAndComments', 'excludedLanguageIds']) {
			await vscode.workspace.getConfiguration('rainbowBrackets').update(key, undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('closing brackets of the first color are matched (#6)', async () => {
		const document = await show('json', '{\n  "manuallyAddedMods": []\n}');
		assert.deepStrictEqual(await colors(document), ['{0', '[0 ]0', '}0']);
	});

	test('Lua (#9)', async () => {
		const document = await show('lua', 'local Result = { }\nlocal function tooltipInit()\n    leftside[i] = left\nend');
		assert.deepStrictEqual(await colors(document), ['{0 }0', '(0 )0', '[0 ]0', '']);
	});

	test('brackets in strings, comments and regular expressions are not colored (#10)', async () => {
		const document = await show('javascript', 'const s = "(" + \'[\' + `{`; // )\nconst re = /[(]/; /* } */\nf(`${ g(1) }`);');
		assert.deepStrictEqual(await colors(document), ['', '', '(0 {0 (1 )1 }0 )0']);
	});

	test('Python strings and comments', async () => {
		const document = await show('python', 'print("(", \')\')  # (\nx = """\n[\n"""\n[x]');
		assert.deepStrictEqual(await colors(document), ['(0 )0', '', '', '', '[0 ]0']);
	});

	test('like in VS Code, the Perl variables $( and $) are not brackets', async () => {
		const document = await show('perl', 'my @ids = ($(, $));\nprint "($)" if ($x);');
		assert.deepStrictEqual(await colors(document), ['(0 )0', '(0 )0']);
	});

	test('edits update the colors of the lines after them', async () => {
		const document = await show('python', 'x = 1\n(\n"""\n()');
		assert.deepStrictEqual(await colors(document), ['', '(0', '', '']);
		// Line 1 goes into a string, and line 2 closes it instead of opening one.
		await edit(document, 0, 4, 0, 5, '"""');
		assert.deepStrictEqual(await colors(document), ['', '', '', '(0 )0']);
		await edit(document, 0, 4, 0, 7, '1');
		assert.deepStrictEqual(await colors(document), ['', '(0', '', '']);
		await edit(document, 3, 2, 3, 2, ')');
		assert.deepStrictEqual(await colors(document), ['', '(0', '', '']);
	});

	test('closing brackets with no opening bracket are isolated', async () => {
		const document = await show('plaintext', ') ( ] )');
		assert.deepStrictEqual(await colors(document), [')! (0 ]! )0']);
	});

	test('every bracket is colored in languages without a grammar', async () => {
		const document = await show('plaintext', '"(" )');
		assert.deepStrictEqual(await colors(document), ['(0 )0']);
	});

	test('rainbowBrackets.ignoreStringsAndComments', async () => {
		const document = await show('javascript', 'f("(")');
		assert.deepStrictEqual(await colors(document), ['(0 )0']);
		await setConfig('ignoreStringsAndComments', false);
		assert.deepStrictEqual(await colors(document), ['(0 (1 )1']);
	});

	test('custom colors apply, also for round brackets, in any number (#8)', async () => {
		await setConfig('roundBracketsColor', ['#111111', '#222222']);
		await setConfig('squareBracketsColor', ['#333333']);
		assert.deepStrictEqual((await api()).colors().round, ['#111111', '#222222']);
		const document = await show('plaintext', '((())) [[]]');
		assert.deepStrictEqual(await colors(document), ['(0 (1 (0 )0 )1 )0 [0 [0 ]0 ]0']);
	});

	test('excluded languages are not colored, also after a language change', async () => {
		const markdown = await show('markdown', '(a)');
		assert.deepStrictEqual(await colors(markdown), ['']);
		const document = await show('plaintext', '(a)');
		assert.deepStrictEqual(await colors(document), ['(0 )0']);
		const changed = await vscode.languages.setTextDocumentLanguage(document, 'markdown');
		assert.deepStrictEqual(await colors(changed), ['']);
		await setConfig('excludedLanguageIds', []);
		assert.deepStrictEqual(await colors(changed), ['(0 )0']);
	});

	test('colors keep updating after the theme changes (#12)', async () => {
		const document = await show('plaintext', '()');
		const workbench = vscode.workspace.getConfiguration('workbench');
		const theme = workbench.get('colorTheme');
		try {
			await workbench.update('colorTheme', vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? 'Default Dark Modern' : 'Default Light Modern', vscode.ConfigurationTarget.Global);
			await sleep(500);
			await edit(document, 0, 1, 0, 1, '[]');
			assert.deepStrictEqual(await colors(document), ['(0 [0 ]0 )0']);
		} finally {
			await workbench.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
		}
	});

	test('large documents', async () => {
		const document = await show('javascript', 'f(\n' + '  g("(", [1]),\n'.repeat(20000) + ');');
		const lines = await colors(document);
		assert.strictEqual(lines.length, 20002);
		assert.deepStrictEqual([lines[0], lines[1], lines[20000], lines[20001]], ['(0', '(1 [0 ]0 )1', '(1 [0 ]0 )1', ')0']);
	});
});
