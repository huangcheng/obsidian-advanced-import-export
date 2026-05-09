import type { NormalizedNote } from "../provider";
import type { McpToolDefinition } from "../../mcp/types";

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

const PREFERRED_TOOL_NAMES = [
	"memo_create",
	"write_note",
	"write_memo",
	"create_memo",
	"create_note",
] as const;

const WRITE_VERB_PREFIXES = ["write_", "create_", "add_", "save_"] as const;

/**
 * Choose which MCP tool to call when pushing a memo to Flomo.
 *
 * The official Flomo server (https://flomoapp.com/mcp) exposes
 * `memo_create`. The community `chatmcp/mcp-server-flomo` fork uses
 * `write_note` / `write_memo`. We accept any of those (preferring the
 * official name) and let the user override when the server eventually
 * changes its name. As a last resort we look for any tool whose name
 * combines a write verb with "memo" / "note".
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
	const heuristic = tools.find((t) => {
		const name = t.name.toLowerCase();
		const hasNoun = name.includes("memo") || name.includes("note");
		const hasVerb = WRITE_VERB_PREFIXES.some((p) => name.startsWith(p));
		return hasNoun && hasVerb;
	});
	if (heuristic) return heuristic.name;
	throw new Error(
		"Flomo MCP advertised no write tool. Expected one of " +
			`${PREFERRED_TOOL_NAMES.join(", ")}. ` +
			`Server tools: ${tools.map((t) => t.name).join(", ") || "(none)"}. ` +
			"Set 'writeToolName' in settings to pick one manually.",
	);
}
