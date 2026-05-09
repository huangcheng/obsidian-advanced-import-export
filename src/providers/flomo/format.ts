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
