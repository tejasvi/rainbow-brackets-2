const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
	{
		ignores: ["node_modules/**", ".vscode-test/**"],
	},
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "commonjs",
			globals: {
				...globals.node,
				...globals.mocha,
			},
		},
		rules: {
			"no-const-assign": "warn",
			"no-this-before-super": "warn",
			"no-undef": "warn",
			"no-unreachable": "warn",
			"no-unused-vars": "warn",
			"constructor-super": "warn",
			"valid-typeof": "warn",
		},
	},
];
