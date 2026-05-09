import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		rules: {
			"obsidianmd/ui/sentence-case": ["error", {
				brands: [
					// Default brands (from eslint-plugin-obsidianmd)
					"iOS", "iPadOS", "macOS", "Windows", "Android", "Linux",
					"Obsidian", "Obsidian Sync", "Obsidian Publish",
					"Google Drive", "Dropbox", "OneDrive", "iCloud Drive",
					"YouTube", "Slack", "Discord", "Telegram", "WhatsApp", "Twitter", "X",
					"Readwise", "Zotero",
					"Excalidraw", "Mermaid",
					"Markdown", "LaTeX", "JavaScript", "TypeScript", "Node.js",
					"npm", "pnpm", "Yarn", "Git", "GitHub",
					"GitLab", "Notion", "Evernote", "Roam Research", "Logseq",
					"Anki", "Reddit", "VS Code", "Visual Studio Code",
					"IntelliJ IDEA", "WebStorm", "PyCharm",
					// Project-specific brands
					"Bear", "WPS", "WPS Note", "WPS Cloud Note", "Youdao", "Youdao Note",
					"MCP", "Advanced Import/Export", "macOS", "iOS", "Flomo",
				],
			}],
		},
	},
	{
		files: ["**/*.test.ts"],
		rules: {
			"import/no-nodejs-modules": "off",
			"@typescript-eslint/no-floating-promises": "off",
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
