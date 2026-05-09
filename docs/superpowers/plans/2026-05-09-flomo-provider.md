# Flomo Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Flomo provider that exports the active note (or a multi-file selection) to Flomo via Flomo's official streamable-HTTP MCP endpoint at `https://flomoapp.com/mcp`, gated by a user-supplied bearer token.

**Architecture:** New `flomo` provider kind that mirrors the WPS provider's MCP path but is push-only (Flomo MCP is a write API; `fetch`/`listRemote` throw "not supported"). Reuses the existing `McpClient` (streamable-HTTP transport) and the existing transformer pipeline. Wired into commands, file-menu submenus, and the settings tab the same way WPS / Youdao are.

**Tech Stack:** TypeScript, Obsidian Plugin API, `@modelcontextprotocol/sdk` (streamable-HTTP), `node --test` + `tsx` for unit tests, esbuild for bundling.

**Reference docs:**
- Flomo MCP entry: https://help.flomoapp.com/advance/mcp/
- Token auth: https://help.flomoapp.com/advance/mcp/token.html
- Endpoint: `https://flomoapp.com/mcp` (HTTP, streamable, Bearer token in `Authorization` header).
- Tool: `write_note` (as exposed by the official server and the community `chatmcp/mcp-server-flomo` reference). Field: `content` (string). Memo titles are not a Flomo concept — we prepend the note's title as a `# Heading` to the body.

**Note on the tool name:** the search snippets I reviewed sometimes call this `write_memo` instead of `write_note`. To stay resilient without bloating UX, the picker prefers `write_note`, then `write_memo`, then any tool whose name starts with `write_` and accepts a `content` field. The chosen-tool name is logged via `testConnection`.

---

## File Structure

**New files:**
- `src/providers/flomo/types.ts` — `FlomoProviderConfig`, `DEFAULT_FLOMO_CONFIG`, `FLOMO_MCP_URL`.
- `src/providers/flomo/format.ts` — pure helpers: `formatFlomoContent(note)`, `pickFlomoWriteTool(tools)`.
- `src/providers/flomo/format.test.ts` — unit tests for the pure helpers.
- `src/providers/flomo/flomo-provider.ts` — `FlomoProvider` class + `flomoFactory`.

**Modified files:**
- `src/providers/registry.ts` — extend `ProviderKind` union with `"flomo"`.
- `src/providers/factories.ts` — register `flomoFactory`.
- `src/settings/index.ts` — add `FlomoProviderConfig` to `ProviderConfig` union; seed in `applyDefaultProviderMigration`.
- `src/settings/settings-tab.ts` — render Flomo card.
- `src/main.ts` — `listFlomoConfigs`, `pickFlomoAndExport`, `addFlomoSubmenus`, command `export-active-to-flomo`.
- `src/ui/brand-names.ts` — add `FLOMO_NAME`.
- `eslint.config.mts` — add `"Flomo"` to the brand list.

---

## Task 1: Add Flomo config types and constants

**Files:**
- Create: `src/providers/flomo/types.ts`
- Modify: `src/providers/registry.ts:3` (extend `ProviderKind`)

- [ ] **Step 1.1: Extend `ProviderKind` to include `"flomo"`**

Edit `src/providers/registry.ts` line 3, replacing:

```ts
export type ProviderKind = "cli" | "mcp" | "http" | "bear" | "wps" | "youdao";
```

with:

```ts
export type ProviderKind = "cli" | "mcp" | "http" | "bear" | "wps" | "youdao" | "flomo";
```

- [ ] **Step 1.2: Create the Flomo types file**

Create `src/providers/flomo/types.ts`:

```ts
import { ProviderConfigBase } from "../registry";

export interface FlomoProviderConfig extends ProviderConfigBase {
	kind: "flomo";
	/** Bearer token issued from https://flomoapp.com (Settings → MCP). */
	apiToken?: string;
	/** Override for the MCP write tool name. Default: auto-pick from the server's tool list. */
	writeToolName?: string;
}

export const FLOMO_MCP_URL = "https://flomoapp.com/mcp";

export const DEFAULT_FLOMO_CONFIG: Omit<FlomoProviderConfig, "id" | "displayName"> = {
	kind: "flomo",
	enabled: true,
	trusted: false,
};

export const FLOMO_TOKEN_HELP_URL = "https://help.flomoapp.com/advance/mcp/token.html";
```

- [ ] **Step 1.3: Verify the project still builds**

Run: `npm run build`
Expected: `tsc -noEmit` succeeds; esbuild emits `main.js` without errors.

- [ ] **Step 1.4: Commit**

```bash
git add src/providers/flomo/types.ts src/providers/registry.ts
git commit -m "feat(flomo): add provider config types"
```

---

## Task 2: Pure helper — `formatFlomoContent`

Flomo memos have no title field. We embed the note title as a leading `#` heading and the tag list as a single line of inline `#tags` after the title (Flomo's tag convention).

**Files:**
- Create: `src/providers/flomo/format.ts`
- Test: `src/providers/flomo/format.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/providers/flomo/format.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { formatFlomoContent } from "./format";
import type { NormalizedNote } from "../provider";

function note(overrides: Partial<NormalizedNote>): NormalizedNote {
	return {
		remoteId: "",
		title: "",
		body: "",
		tags: [],
		attachments: [],
		sourceMeta: {},
		...overrides,
	};
}

describe("formatFlomoContent", () => {
	it("prepends title as a level-1 heading", () => {
		const out = formatFlomoContent(note({ title: "Daily log", body: "First line." }));
		assert.equal(out, "# Daily log\n\nFirst line.");
	});

	it("renders tags as a #tag line beneath the title", () => {
		const out = formatFlomoContent(
			note({ title: "Idea", body: "Body.", tags: ["work", "ai/llm"] }),
		);
		assert.equal(out, "# Idea\n\n#work #ai/llm\n\nBody.");
	});

	it("emits body only when there is no title", () => {
		const out = formatFlomoContent(note({ body: "Just a memo." }));
		assert.equal(out, "Just a memo.");
	});

	it("emits tags + body when title is empty", () => {
		const out = formatFlomoContent(note({ body: "Memo.", tags: ["quick"] }));
		assert.equal(out, "#quick\n\nMemo.");
	});

	it("trims trailing whitespace from the body", () => {
		const out = formatFlomoContent(note({ title: "T", body: "Body.\n\n\n" }));
		assert.equal(out, "# T\n\nBody.");
	});

	it("returns an empty string when title, tags, and body are all empty", () => {
		const out = formatFlomoContent(note({}));
		assert.equal(out, "");
	});

	it("strips a leading '#' that the user already added to a tag", () => {
		const out = formatFlomoContent(note({ body: "x", tags: ["#already", "raw"] }));
		assert.equal(out, "#already #raw\n\nx");
	});
});
```

- [ ] **Step 2.2: Run the test to confirm it fails**

Run: `node --test --import tsx src/providers/flomo/format.test.ts`
Expected: fails with "Cannot find module './format'" (or similar — the module doesn't exist yet).

- [ ] **Step 2.3: Implement `formatFlomoContent`**

Create `src/providers/flomo/format.ts`:

```ts
import type { NormalizedNote } from "../provider";

/**
 * Render a NormalizedNote as a single Flomo memo content string.
 *
 * Flomo memos have no separate title field; we embed the title as a
 * leading `# Heading` and tags as a single inline `#tag` line.
 * Blank sections collapse to nothing — an empty input yields "".
 */
export function formatFlomoContent(note: NormalizedNote): string {
	const segments: string[] = [];
	const title = note.title.trim();
	if (title) segments.push(`# ${title}`);

	const tags = note.tags
		.map((t) => t.trim().replace(/^#+/, ""))
		.filter((t) => t.length > 0)
		.map((t) => `#${t}`);
	if (tags.length > 0) segments.push(tags.join(" "));

	const body = note.body.replace(/\s+$/, "");
	if (body.length > 0) segments.push(body);

	return segments.join("\n\n");
}
```

- [ ] **Step 2.4: Re-run the test to confirm it passes**

Run: `node --test --import tsx src/providers/flomo/format.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/providers/flomo/format.ts src/providers/flomo/format.test.ts
git commit -m "feat(flomo): add formatFlomoContent helper"
```

---

## Task 3: Pure helper — `pickFlomoWriteTool`

Flomo's official server exposes `write_note`. The community fork uses `write_memo`. Both accept a `content` string. The picker prefers an explicit override, falls back to `write_note`, then `write_memo`, then any tool name starting with `write_`. Throws when no candidate exists.

**Files:**
- Modify: `src/providers/flomo/format.ts` (append helper)
- Modify: `src/providers/flomo/format.test.ts` (append cases)

- [ ] **Step 3.1: Append failing tests**

Add to `src/providers/flomo/format.test.ts` after the existing imports:

```ts
import { pickFlomoWriteTool } from "./format";
import type { McpToolDefinition } from "../../mcp/types";

function tool(name: string): McpToolDefinition {
	return { name, inputSchema: { type: "object" } };
}

describe("pickFlomoWriteTool", () => {
	it("returns the configured override when present in the tool list", () => {
		const t = pickFlomoWriteTool([tool("write_note"), tool("custom_write")], "custom_write");
		assert.equal(t, "custom_write");
	});

	it("throws if the override is not present", () => {
		assert.throws(
			() => pickFlomoWriteTool([tool("write_note")], "missing_tool"),
			/missing_tool/,
		);
	});

	it("prefers write_note when both candidates are present", () => {
		const t = pickFlomoWriteTool([tool("write_memo"), tool("write_note")]);
		assert.equal(t, "write_note");
	});

	it("falls back to write_memo when write_note is absent", () => {
		const t = pickFlomoWriteTool([tool("write_memo"), tool("read_note")]);
		assert.equal(t, "write_memo");
	});

	it("falls back to any write_* tool when neither canonical name exists", () => {
		const t = pickFlomoWriteTool([tool("write_thing")]);
		assert.equal(t, "write_thing");
	});

	it("throws with a useful message when no write tool exists", () => {
		assert.throws(
			() => pickFlomoWriteTool([tool("read_note"), tool("search")]),
			/no write tool/i,
		);
	});
});
```

- [ ] **Step 3.2: Run the test to confirm it fails**

Run: `node --test --import tsx src/providers/flomo/format.test.ts`
Expected: the new `pickFlomoWriteTool` cases fail with "Export `pickFlomoWriteTool` not found" (or similar).

- [ ] **Step 3.3: Implement the helper**

Append to `src/providers/flomo/format.ts`:

```ts
import type { McpToolDefinition } from "../../mcp/types";

const PREFERRED_TOOL_NAMES = ["write_note", "write_memo"] as const;

/**
 * Choose which MCP tool to call when pushing a memo to Flomo.
 *
 * The official Flomo server exposes `write_note`. The community
 * `chatmcp/mcp-server-flomo` fork uses `write_memo`. We accept either
 * (preferring the official name) and let the user override when the
 * server eventually changes its name.
 */
export function pickFlomoWriteTool(
	tools: McpToolDefinition[],
	override?: string,
): string {
	const trimmed = override?.trim();
	if (trimmed) {
		if (tools.some((t) => t.name === trimmed)) return trimmed;
		throw new Error(
			`Configured Flomo tool '${trimmed}' is not advertised by the server. ` +
				`Available tools: ${tools.map((t) => t.name).join(", ") || "(none)"}.`,
		);
	}
	for (const candidate of PREFERRED_TOOL_NAMES) {
		if (tools.some((t) => t.name === candidate)) return candidate;
	}
	const writeAny = tools.find((t) => t.name.startsWith("write_"));
	if (writeAny) return writeAny.name;
	throw new Error(
		"Flomo MCP advertised no write tool. Expected `write_note` or `write_memo`. " +
			`Server tools: ${tools.map((t) => t.name).join(", ") || "(none)"}.`,
	);
}
```

- [ ] **Step 3.4: Re-run the test to confirm it passes**

Run: `node --test --import tsx src/providers/flomo/format.test.ts`
Expected: all tests (formatFlomoContent + pickFlomoWriteTool) pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/providers/flomo/format.ts src/providers/flomo/format.test.ts
git commit -m "feat(flomo): add pickFlomoWriteTool helper"
```

---

## Task 4: `FlomoProvider` scaffolding

**Files:**
- Create: `src/providers/flomo/flomo-provider.ts`

- [ ] **Step 4.1: Create the provider class with non-push paths**

Create `src/providers/flomo/flomo-provider.ts`:

```ts
import { McpClient } from "../../mcp/mcp-client";
import { McpServerConfig } from "../../mcp/types";
import {
	FetchOptions,
	ListOptions,
	NormalizedNote,
	Provider,
	ProviderAvailability,
	ProviderCapabilities,
	RemoteListItem,
} from "../provider";
import { ProviderFactory } from "../registry";
import { formatFlomoContent, pickFlomoWriteTool } from "./format";
import { FLOMO_MCP_URL, FlomoProviderConfig } from "./types";

/**
 * Push-only provider for Flomo's official streamable-HTTP MCP at
 * `https://flomoapp.com/mcp`. Authenticates with a Bearer token issued
 * via Flomo's MCP settings page. Read paths (fetch / listRemote) are
 * unsupported because Flomo's MCP is a write surface today; if that
 * changes we add them later.
 */
export class FlomoProvider implements Provider {
	readonly id: string;
	readonly displayName: string;
	readonly icon = "notebook-pen";
	readonly capabilities: ProviderCapabilities = {
		canImport: false,
		canExport: true,
		supportsBulk: true,
		supportsAttachments: false,
	};

	private mcpClient: McpClient | null = null;

	constructor(private readonly config: FlomoProviderConfig) {
		this.id = config.id;
		this.displayName = config.displayName || "Flomo";
	}

	available(): ProviderAvailability {
		const token = this.config.apiToken?.trim();
		if (!token) {
			return { ok: false, reason: "Add a Flomo API token in settings" };
		}
		return { ok: true };
	}

	async push(_note: NormalizedNote): Promise<{ remoteId: string }> {
		throw new Error("FlomoProvider.push: not implemented yet");
	}

	async fetch(_remoteId: string, _opts?: FetchOptions): Promise<NormalizedNote> {
		throw new Error("Flomo MCP does not support reading memos");
	}

	async listRemote(_opts?: ListOptions): Promise<RemoteListItem[]> {
		throw new Error("Flomo MCP does not support listing memos");
	}

	async testConnection(): Promise<{ ok: boolean; message?: string }> {
		return { ok: false, message: "Not implemented yet" };
	}

	async dispose(): Promise<void> {
		if (this.mcpClient) {
			await this.mcpClient.disconnect().catch(() => {});
			this.mcpClient = null;
		}
	}

	private async connectMcp(): Promise<McpClient> {
		if (this.mcpClient) {
			const state = this.mcpClient.getState();
			if (state.status === "connected") return this.mcpClient;
			await this.mcpClient.disconnect().catch(() => {});
			this.mcpClient = null;
		}
		const token = this.config.apiToken?.trim();
		if (!token) throw new Error("Flomo API token is missing");
		const cfg: McpServerConfig = {
			id: `${this.config.id}-mcp`,
			kind: "mcp",
			displayName: this.displayName,
			enabled: true,
			trusted: true,
			transportType: "http",
			url: FLOMO_MCP_URL,
			headers: { Authorization: `Bearer ${token}` },
		};
		const client = new McpClient(cfg);
		await client.connect();
		this.mcpClient = client;
		return client;
	}
}

export const flomoFactory: ProviderFactory<FlomoProviderConfig> = {
	kind: "flomo",
	create(config) {
		return new FlomoProvider(config);
	},
};
```

- [ ] **Step 4.2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (the unused `_note` / `_remoteId` / `_opts` parameters are fine — `noUnusedParameters` is not enabled in `tsconfig.json`; `useUnknownInCatchVariables` is unrelated). The `formatFlomoContent` / `pickFlomoWriteTool` imports are unused at this stage; the build still succeeds because TypeScript tolerates unused imports unless `noUnusedLocals` is set, and esbuild tree-shakes them.

If the build fails on unused imports, remove them temporarily; Task 5 re-introduces them.

- [ ] **Step 4.3: Commit**

```bash
git add src/providers/flomo/flomo-provider.ts
git commit -m "feat(flomo): scaffold FlomoProvider class and factory"
```

---

## Task 5: Implement `push` (the core export)

**Files:**
- Modify: `src/providers/flomo/flomo-provider.ts`

- [ ] **Step 5.1: Replace `push` with the real implementation**

In `src/providers/flomo/flomo-provider.ts`, replace the placeholder `push` method with:

```ts
	async push(note: NormalizedNote): Promise<{ remoteId: string }> {
		const content = formatFlomoContent(note);
		if (content.length === 0) {
			throw new Error("Cannot push an empty memo to Flomo");
		}
		const client = await this.connectMcp();
		const toolName = pickFlomoWriteTool(client.getTools(), this.config.writeToolName);
		const result = await client.invokeTool(toolName, { content });
		if (result.isError) {
			const text = result.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			throw new Error(`Flomo ${toolName} failed: ${text || "unknown error"}`);
		}
		const text = result.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();
		return { remoteId: extractMemoUrl(text) ?? "" };
	}
```

- [ ] **Step 5.2: Add the `extractMemoUrl` helper at the bottom of the file**

Append below the `flomoFactory` export:

```ts
/**
 * Pull a Flomo memo URL out of the server's response when present.
 * The official server returns text like:
 *   "Successfully wrote memo: https://v.flomoapp.com/mine/?memo_id=xxxxx"
 * Falls back to the empty string when no URL is found, leaving
 * `remoteId` empty (matches the WPS / Bear conventions for write-only
 * round trips).
 */
function extractMemoUrl(text: string): string | null {
	const match = text.match(/https?:\/\/[^\s)>]+/);
	return match ? match[0] : null;
}
```

- [ ] **Step 5.3: Verify the build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5.4: Commit**

```bash
git add src/providers/flomo/flomo-provider.ts
git commit -m "feat(flomo): implement push via MCP write_note"
```

---

## Task 6: Implement `testConnection`

**Files:**
- Modify: `src/providers/flomo/flomo-provider.ts`

- [ ] **Step 6.1: Replace the stub `testConnection`**

In `src/providers/flomo/flomo-provider.ts`, replace the body of `testConnection`:

```ts
	async testConnection(): Promise<{ ok: boolean; message?: string }> {
		try {
			const client = await this.connectMcp();
			const tools = client.getTools();
			const writeTool = pickFlomoWriteTool(tools, this.config.writeToolName);
			return {
				ok: true,
				message: `Connected — ${tools.length} tool(s) advertised; will call '${writeTool}'`,
			};
		} catch (err) {
			return { ok: false, message: err instanceof Error ? err.message : String(err) };
		}
	}
```

- [ ] **Step 6.2: Verify the build**

Run: `npm run build`
Expected: success.

- [ ] **Step 6.3: Commit**

```bash
git add src/providers/flomo/flomo-provider.ts
git commit -m "feat(flomo): implement testConnection"
```

---

## Task 7: Register factory + brand name + default migration

**Files:**
- Modify: `src/providers/factories.ts`
- Modify: `src/ui/brand-names.ts`
- Modify: `src/settings/index.ts`
- Modify: `eslint.config.mts`

- [ ] **Step 7.1: Register the factory**

Edit `src/providers/factories.ts`:

```ts
import { bearFactory } from "./bear/bear-provider";
import { flomoFactory } from "./flomo/flomo-provider";
import { ProviderRegistry } from "./registry";
import { wpsFactory } from "./wps/wps-provider";
import { youdaoFactory } from "./youdao/youdao-provider";

export function registerAllFactories(registry: ProviderRegistry): void {
	registry.registerFactory(bearFactory);
	registry.registerFactory(wpsFactory);
	registry.registerFactory(youdaoFactory);
	registry.registerFactory(flomoFactory);
}
```

- [ ] **Step 7.2: Add the brand name**

Edit `src/ui/brand-names.ts`:

```ts
export const BEAR_NAME = "Bear";
export const WPS_NAME = "WPS Cloud Note";
export const YOUDAO_NAME = "Youdao Note";
export const FLOMO_NAME = "Flomo";
export const PLUGIN_NAME = "Cross-App Notes Bridge";
```

- [ ] **Step 7.3: Whitelist "Flomo" in the sentence-case linter**

Edit `eslint.config.mts`. Find the `brands` array (around line 29) and add `"Flomo"` at the end of the project-specific brands group, so the closing portion reads:

```ts
					// Project-specific brands
					"Bear", "WPS", "WPS Note", "WPS Cloud Note", "Youdao", "Youdao Note",
					"MCP", "Advanced Import/Export", "macOS", "iOS", "Flomo",
```

- [ ] **Step 7.4: Seed Flomo in the default-provider migration**

Edit `src/settings/index.ts`. Update the imports and `ProviderConfig` union, and append a Flomo seed in `applyDefaultProviderMigration`:

Imports — add this line near the existing provider imports:

```ts
import { DEFAULT_FLOMO_CONFIG, FlomoProviderConfig } from "../providers/flomo/types";
```

Update `ProviderConfig`:

```ts
export type ProviderConfig =
	| BearProviderConfig
	| WpsProviderConfig
	| YoudaoProviderConfig
	| FlomoProviderConfig
	| ProviderConfigBase;
```

Append inside `applyDefaultProviderMigration` (after the Youdao block):

```ts
	if (!settings.providers.some((p) => p.kind === "flomo")) {
		const cfg: FlomoProviderConfig = {
			id: "flomo",
			displayName: "Flomo",
			...DEFAULT_FLOMO_CONFIG,
		};
		settings.providers.push(cfg);
	}
```

- [ ] **Step 7.5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both succeed. If the linter flags any user-facing string referring to Flomo by mixed case, the brand-name whitelist fix in Step 7.3 should already cover it.

- [ ] **Step 7.6: Commit**

```bash
git add src/providers/factories.ts src/ui/brand-names.ts src/settings/index.ts eslint.config.mts
git commit -m "feat(flomo): register factory and seed default config"
```

---

## Task 8: Wire commands and file-menu submenu in `main.ts`

The Flomo wiring mirrors WPS exactly — same `pickProviderConfig` flow, same `exportToProvider` helper, same submenu shape. The `exportToProvider` method's signature already accepts a union of `WpsProviderConfig | YoudaoProviderConfig`; we widen it to include `FlomoProviderConfig`.

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 8.1: Add the Flomo imports**

In `src/main.ts` near the existing provider imports, add:

```ts
import { FlomoProviderConfig } from "./providers/flomo/types";
import { FLOMO_NAME } from "./ui/brand-names";
```

Update the existing `WPS_NAME, YOUDAO_NAME, …` line to also pull in `FLOMO_NAME` if you prefer a single import; either form is fine.

- [ ] **Step 8.2: Add the Flomo command in `onload`**

After the `export-active-to-youdao` command block, add:

```ts
		this.addCommand({
			id: "export-active-to-flomo",
			name: `Send active note to ${FLOMO_NAME}…`,
			checkCallback: (checking) => {
				if (this.listFlomoConfigs().length === 0) return false;
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.pickFlomoAndExport(sel.notes);
				return true;
			},
		});
```

- [ ] **Step 8.3: Hook the Flomo submenu into `addPluginSubmenu`**

In `addPluginSubmenu`, after `this.addYoudaoSubmenus(sub, notes);`, add:

```ts
			this.addFlomoSubmenus(sub, notes);
```

- [ ] **Step 8.4: Add `addFlomoSubmenus`**

After `addYoudaoSubmenus`, add the Flomo equivalent:

```ts
	private addFlomoSubmenus(menu: Menu, files: TFile[]): void {
		if (files.length === 0) return;
		const configs = this.listFlomoConfigs();
		if (configs.length === 0) return;
		for (const config of configs) {
			const provider = this.registry.get(config.id);
			const avail = provider?.available?.() ?? { ok: false, reason: "Enable + trust this provider in Settings" };
			menu.addItem((item) => {
				item.setTitle(config.displayName).setIcon("notebook-pen");
				const submenu = (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();
				submenu.addItem((sub: MenuItem) =>
					sub
						.setTitle(
							files.length === 1
								? `Export note to ${config.displayName}`
								: `Export ${files.length} notes to ${config.displayName}`,
						)
						.setIcon("upload")
						.setDisabled(!avail.ok)
						.onClick(async () => {
							try {
								await this.exportToProvider(config, files);
							} catch (err) {
								new Notice(`Export failed: ${errorMessage(err)}`);
							}
						}),
				);
				if (!avail.ok && avail.reason) {
					submenu.addItem((sub: MenuItem) =>
						sub.setTitle(`(${avail.reason})`).setDisabled(true),
					);
				}
			});
		}
	}
```

- [ ] **Step 8.5: Add `listFlomoConfigs` and `pickFlomoAndExport`**

After `pickWpsAndExport`, add:

```ts
	private listFlomoConfigs(): FlomoProviderConfig[] {
		return this.settings.providers.filter(
			(p): p is FlomoProviderConfig => p.kind === "flomo" && p.enabled !== false,
		);
	}

	private async pickFlomoAndExport(files: TFile[]): Promise<void> {
		const configs = this.listFlomoConfigs();
		if (configs.length === 0) {
			new Notice(`No ${FLOMO_NAME} providers configured`);
			return;
		}
		const target = configs.length === 1 ? configs[0]! : await this.pickProviderConfig(configs, "Select Flomo provider…");
		if (!target) return;
		await this.exportToProvider(target, files);
	}
```

- [ ] **Step 8.6: Widen `exportToProvider` to accept the Flomo config**

Find the `exportToProvider` declaration:

```ts
	private async exportToProvider(
		config: WpsProviderConfig | YoudaoProviderConfig,
		files: TFile[],
	): Promise<void> {
```

Replace with:

```ts
	private async exportToProvider(
		config: WpsProviderConfig | YoudaoProviderConfig | FlomoProviderConfig,
		files: TFile[],
	): Promise<void> {
```

Inside the same method, find:

```ts
		const provider = this.registry.get(config.id) as WpsProvider | YoudaoProvider | null;
```

Replace with:

```ts
		const provider = this.registry.get(config.id);
```

(The method only uses `provider.available?.()` and `provider.push(...)`, both of which are on the `Provider` interface, so the broad type works without per-provider casts.)

- [ ] **Step 8.7: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 8.8: Commit**

```bash
git add src/main.ts
git commit -m "feat(flomo): wire commands and file-menu submenu"
```

---

## Task 9: Settings UI — Flomo provider card

The card is small: token, optional tool-name override, display name, enabled, trusted, test connection.

**Files:**
- Modify: `src/settings/settings-tab.ts`

- [ ] **Step 9.1: Add imports**

In `src/settings/settings-tab.ts`, add to the existing import block:

```ts
import { FlomoProvider } from "../providers/flomo/flomo-provider";
import { FlomoProviderConfig, FLOMO_TOKEN_HELP_URL } from "../providers/flomo/types";
import { FLOMO_NAME } from "../ui/brand-names";
```

- [ ] **Step 9.2: Update the providers intro paragraph**

In `display()`, find:

```ts
		containerEl.createEl("p", {
			text: `Configure note-source integrations for ${BEAR_NAME}, ${WPS_NAME}, and ${YOUDAO_NAME}. Each provider exposes import / export operations to the plugin's commands and the file-explorer right-click menu.`,
		});
```

Replace with:

```ts
		containerEl.createEl("p", {
			text: `Configure note-source integrations for ${BEAR_NAME}, ${WPS_NAME}, ${YOUDAO_NAME}, and ${FLOMO_NAME}. Each provider exposes import / export operations to the plugin's commands and the file-explorer right-click menu.`,
		});
```

- [ ] **Step 9.3: Route the new kind in `renderProviderCard`**

In `renderProviderCard`, add a case before `default`:

```ts
			case "flomo":
				this.renderFlomoProvider(containerEl, config as FlomoProviderConfig);
				return;
```

- [ ] **Step 9.4: Add `renderFlomoProvider`**

Add the method to the class (placement: after `renderYoudaoProvider` is fine):

```ts
	private renderFlomoProvider(parentEl: HTMLElement, config: FlomoProviderConfig): void {
		const containerEl = this.openCollapsibleCard(
			parentEl,
			config.displayName || "Flomo",
			config,
		);
		const intro = containerEl.createEl("p");
		intro.appendText(
			`Export memos to ${FLOMO_NAME} via its official MCP server. Requires a Flomo Pro account and an API token. `,
		);
		intro
			.createEl("a", {
				text: "Get a token",
				href: FLOMO_TOKEN_HELP_URL,
			})
			.setAttr("target", "_blank");

		new Setting(containerEl).setName("Display name").addText((text) =>
			text.setValue(config.displayName).onChange(async (v) => {
				config.displayName = v.trim() || "Flomo";
				await this.plugin.saveSettings();
			}),
		);

		new Setting(containerEl)
			.setName("API token")
			.setDesc("Stored locally. Sent to https://flomoapp.com/mcp as 'Authorization: Bearer <token>'.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(config.apiToken ?? "").onChange(async (v) => {
					config.apiToken = v.trim() || undefined;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Write tool name")
			.setDesc("Optional override. Leave empty to auto-pick (write_note → write_memo → first write_*).")
			.addText((text) =>
				text
					.setValue(config.writeToolName ?? "")
					.onChange(async (v) => {
						config.writeToolName = v.trim() || undefined;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Enabled").addToggle((tog) =>
			tog.setValue(config.enabled).onChange(async (v) => {
				config.enabled = v;
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl)
			.setName("Trusted")
			.setDesc(`Allow this provider to send memos to ${FLOMO_NAME}.`)
			.addToggle((tog) =>
				tog.setValue(config.trusted).onChange(async (v) => {
					config.trusted = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.addButton((btn) =>
				btn.setButtonText("Test").onClick(async () => {
					const provider = this.plugin.registry.get(config.id) as FlomoProvider | null;
					if (!provider) {
						new Notice("Save the provider first (enabled + trusted) and retry.");
						return;
					}
					const notice = new Notice("Testing connection...", 0);
					const result = await provider.testConnection?.();
					notice.hide();
					new Notice(result?.message ?? (result?.ok ? "Connected" : "Connection failed"));
				}),
			);
	}
```

- [ ] **Step 9.5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 9.6: Commit**

```bash
git add src/settings/settings-tab.ts
git commit -m "feat(flomo): add settings card"
```

---

## Task 10: Final sweep — full test + lint + manual smoke check

- [ ] **Step 10.1: Run the full test suite**

Run: `npm test`
Expected: all `formatFlomoContent` and `pickFlomoWriteTool` cases pass; no other tests exist yet.

- [ ] **Step 10.2: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 10.3: Production build**

Run: `npm run build`
Expected: `tsc -noEmit` and esbuild both succeed; `main.js` is regenerated.

- [ ] **Step 10.4: Manual smoke test (cannot be automated — depends on a real Flomo account)**

Tell the user the steps:

1. Copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/advanced-import-export/`.
2. In Obsidian, reload the plugin. Open Settings → Community plugins → Cross-App Notes Bridge.
3. Expand the Flomo card. Paste the Flomo token from https://help.flomoapp.com/advance/mcp/token.html, toggle Enabled + Trusted, click Test. Expect a notice like "Connected — N tool(s) advertised; will call 'write_note'".
4. Open any note. Run `Send active note to Flomo…` from the command palette. Confirm a notice "Exported 1 note to Flomo" and that the memo appears in the Flomo web UI.
5. Right-click a file → Cross-App Notes Bridge → Flomo → Export note to Flomo. Same expected outcome.
6. Try with a multi-file selection in the file explorer to verify bulk export works.

If step 4 fails with "Configured Flomo tool '...' is not advertised" or "Flomo MCP advertised no write tool", the official Flomo server has shipped a different tool name. Set the `Write tool name` field in settings to the value reported in the error message.

- [ ] **Step 10.5: Tag-final-commit (only if no follow-up issues from manual test)**

```bash
git log --oneline -10
```

Confirm the commit history shows the Flomo work and nothing extraneous.

---

## Self-review notes

- **Spec coverage:** the user requested "support for flomo, http MCP, only export, like the WPS provider". Tasks 1–9 cover types, helpers, provider, factory, settings, command, submenu — same surface area WPS occupies. Read paths are deliberately stubbed (`fetch` / `listRemote` throw), as Flomo MCP is write-only today.
- **Type consistency:** `FlomoProviderConfig` is the single config type, used identically in `types.ts`, `settings/index.ts`, `flomo-provider.ts`, `settings-tab.ts`, and `main.ts`. `formatFlomoContent` and `pickFlomoWriteTool` keep their names across all references.
- **No placeholders:** every step provides full code; no "TBD" or "similar to". Tests are concrete with expected outputs.
- **Risk acknowledged in plan body:** the official Flomo tool name is not 100% confirmed from public docs — `pickFlomoWriteTool` handles the variants and the settings UI lets the user pin a specific name if both fallbacks fail.

Sources used to design the Flomo integration:
- [Flomo MCP overview](https://help.flomoapp.com/advance/mcp/)
- [Flomo MCP token auth](https://help.flomoapp.com/advance/mcp/token.html)
- [chatmcp/mcp-server-flomo (community reference)](https://github.com/chatmcp/mcp-server-flomo)
