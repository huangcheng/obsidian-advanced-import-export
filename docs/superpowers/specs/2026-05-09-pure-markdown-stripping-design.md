# Pure-Markdown stripping for external providers

**Date:** 2026-05-09
**Status:** Approved (pending implementation)

## Problem

Notes exported to Bear, WPS Cloud Note, and Youdao Note must be **pure Markdown**. Non-standard Markdown extensions used inside Obsidian (`%%comments%%`, `^block-id` markers, dataview blocks, wikilink block-refs) and recurring template scaffolding (tag bars, "Related" / "Backlinks" footers) leak into the output today, because the current transform pipeline only handles wikilinks, embeds, callouts, and frontmatter. Some providers render this junk verbatim; others reject it.

## Goal

Make every export path — `Copy as pure Markdown`, `Export as pure Markdown`, and provider pushes (Bear / WPS / Youdao) — produce content that any Markdown renderer can consume without surprises, with no per-provider configuration.

## Non-goals

- Delimiter markers (e.g. `<!-- bridge:strip-start -->`). Forces editing every note; revisit only if heading-list + tag-line coverage proves insufficient.
- Stripping `==highlight==` or `~~strikethrough~~`. Either GFM-standard or widely supported.
- Touching inline `#tag` tokens inside prose. Only lines whose entire content is tags.
- A separate "pure Markdown for providers" toggle. The same transformer feeds all destinations; user-tuned settings apply uniformly.

## Design

### Two new transform passes

**`stripObsidianSyntax`** — new file `src/transforms/obsidian-syntax.ts`. Removes:

| Pattern | Action |
|---|---|
| `%% ... %%` (single-line and multi-line) | Drop content between markers, including the markers. |
| `^block-id` at end of line | Drop the marker (`abc def ^xyz` → `abc def`). |
| Fenced code blocks with language `dataview`, `dataviewjs`, or `query` | Drop the entire fenced block. |

All non-fence patterns use `rewriteOutsideCode` so legitimate code samples that mention `%%` or `^id` survive. The dataview/query rule deliberately matches the fence itself; it walks fences directly rather than through `rewriteOutsideCode`.

**`stripHeaderFooter`** — new file `src/transforms/header-footer.ts`. Two independent operations driven by config:

- **Drop section by heading name** — for each entry in `cfg.dropSectionHeadings` (case-insensitive, trimmed), find every heading line whose text matches and drop it plus all following lines up to the next heading of equal-or-higher level (or EOF). Skips inside fenced code.
- **Drop tag-only lines** — when `cfg.dropTagOnlyLines` is true, drop any line whose entire trimmed content matches `#tag(\s+#tag)*` (one or more `#tag` tokens separated by whitespace). Inline `#tags` in prose are untouched.

### Wikilinks: strip block-ref suffix

The block-ref suffix lives inside wikilinks, so it's a small extension to the existing pass rather than a new file. In `rewriteWikilinks`, when a wikilink target contains `#^abc`, drop everything from `#^` onward before generating the output link. Display text is preserved; only the resolution target is shortened. Heading anchors (`#Heading`) are left alone.

### Pipeline order

```
1. stripFrontmatter
2. stripObsidianSyntax     ← NEW (before embeds: a dataview block can
                              briefly resemble an embed with images)
3. rewriteEmbeds
4. rewriteWikilinks        ← gains #^block-id suffix stripping
5. flattenCallouts
6. stripHeaderFooter       ← NEW (last; operates on fully-rewritten output
                              so dropped sections don't take live links
                              with them prematurely)
```

### Config

Extend `TransformConfig` (`src/transforms/config.ts`):

```ts
export interface TransformConfig {
  // existing
  resolveWikilinks: boolean;
  embedHandling: EmbedHandling;
  flattenCallouts: boolean;
  dropFrontmatter: boolean;
  rewriteAttachments: AttachmentMode;
  // new
  stripObsidianSyntax: boolean;
  dropTagOnlyLines: boolean;
  dropSectionHeadings: string[];
}

export const DEFAULT_TRANSFORM_CONFIG: TransformConfig = {
  resolveWikilinks: true,
  embedHandling: "replace-with-link",
  flattenCallouts: true,
  dropFrontmatter: true,           // changed from false
  rewriteAttachments: "vault-relative",
  stripObsidianSyntax: true,
  dropTagOnlyLines: true,
  dropSectionHeadings: [],
};
```

**`dropFrontmatter` default flips from `false` to `true`.** The product is "Copy as **pure Markdown**" — pure Markdown shouldn't carry YAML frontmatter by default. Existing users keep their value: `loadSettings` in `main.ts` spreads `DEFAULT_SETTINGS.transform` over the saved transform, so any explicit `dropFrontmatter: false` in `data.json` survives. Only fresh installs get the new default.

### Settings UI

Three new rows under "Markdown export transforms" in `settings/settings-tab.ts`, placed after "Drop frontmatter":

- Toggle **Strip Obsidian-specific syntax** — "Remove `%% comments %%`, `^block-id` markers, and `dataview` / `query` code blocks."
- Toggle **Drop tag-only lines** — "Remove lines that contain only `#tags` (typical tag bars at the top of a note)."
- Text input **Drop sections by heading** — placeholder `Related, Backlinks, References`. Stored as a comma-separated string, parsed on save into a trimmed string array; empty entries dropped.

### Report

Extend `TransformReport` and `summarize()`:

```ts
export interface TransformReport {
  // existing fields
  obsidianSyntaxStripped: number;  // total occurrences removed across all sub-rules
  sectionsDropped: number;
  tagLinesDropped: number;
  // ...
}
```

`summarize` adds three lines when counters are non-zero, e.g. `"3 Obsidian-syntax strips, 1 section dropped, 2 tag lines dropped"`.

## Provider push behaviour

The transformer is shared across all paths (Copy / Export-to-folder / `BearProvider.push` / `WpsProvider.push` / `YoudaoProvider.push` — see `src/main.ts` `buildTransformer()` and the provider helpers that call `transformer.run()`). Because defaults strip Obsidian syntax and tag-only lines, all four destinations get pure Markdown without per-provider plumbing. Users who deliberately disable `stripObsidianSyntax` get the same output everywhere — internally consistent.

## Tests

New test files under `node --test --import tsx`, mirroring file layout:

- `src/transforms/obsidian-syntax.test.ts`
  - Strips inline and multi-line `%%comments%%`.
  - Strips `^block-id` at end of line; preserves caret elsewhere.
  - Drops fenced `dataview` / `dataviewjs` / `query` blocks; preserves other fenced blocks.
  - Patterns inside arbitrary fenced code blocks survive.
- `src/transforms/header-footer.test.ts`
  - Section drop removes heading + body until next heading of equal-or-higher level (incl. nested subsections).
  - Section drop is case-insensitive and trims headings.
  - Tag-only-line detection accepts `#a #b`, rejects `text with #tag`.
  - Tag-only matches inside fenced code are not dropped.
- `src/transforms/wikilinks.test.ts` (new or extended)
  - `[[note#^abc]]` resolves as if `note` (suffix stripped).
  - `[[note#Heading]]` keeps the heading anchor in the output link.

## File touch list

- `src/transforms/config.ts` — add three fields, change default.
- `src/transforms/report.ts` — add three counters and summarize entries.
- `src/transforms/obsidian-syntax.ts` — new pass.
- `src/transforms/header-footer.ts` — new pass.
- `src/transforms/wikilinks.ts` — strip `#^block-id` suffix.
- `src/transforms/transformer.ts` — wire new passes into pipeline.
- `src/settings/settings-tab.ts` — three new settings rows.
- Tests as listed above.

No changes to providers, registry, orchestrator, or `main.ts`.

## Risks & open questions

- **Aggressive default for `dropFrontmatter`.** Users who relied on frontmatter passing through to providers will see a behavior change on fresh installs. Mitigated by spreading-on-load: existing settings survive, only new installs flip. Acceptable risk given the product framing as "pure Markdown."
- **Section-drop heading match is name-based.** A note with two `## Related` sections drops both. If users hit this in practice, switch to "drop only the last matching section" or accept a `level:name` syntax. Defer until reported.
- **Dataview blocks dropped, not just delanguaged.** A user who keeps the source code as documentation will lose it. They can disable `stripObsidianSyntax` or rename the language to `text`/`md`.
