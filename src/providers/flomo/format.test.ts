import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { formatFlomoContent, pickFlomoWriteTool } from "./format";
import type { NormalizedNote } from "../provider";
import type { McpToolDefinition } from "../../mcp/types";

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

function tool(name: string): McpToolDefinition {
	return { name, inputSchema: { type: "object" } };
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
