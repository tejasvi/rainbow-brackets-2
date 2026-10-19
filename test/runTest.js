const fs = require('fs');
const os = require('os');
const path = require('path');

const { runTests } = require('@vscode/test-electron');

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../');

		// The path to the extension test script
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// Download VS Code, unzip it and run the integration test
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			// A new profile each time, so that settings changed by a failed test do not stay
			launchArgs: ['--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'rainbow-brackets-test-'))}`],
		});
	} catch (err) {
		console.error('Failed to run tests', err);
		process.exit(1);
	}
}

main();
