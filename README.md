# Cross-App Notes Bridge

An [Obsidian](https://obsidian.md) plugin that exports notes as portable Markdown and bridges your vault with other note-taking apps — Bear (via `x-callback-url`), WPS Cloud Note, and Youdao Note (via their respective CLI/MCP clients).

Mobile-safe: stdio MCP transports and Bear are guarded at runtime and degrade gracefully on iOS/Android.

## Why one plugin instead of three?

These integrations share the same pipeline — selection → Markdown transforms → provider dispatch — and most users who care about Markdown portability use more than one of these apps. Bundling avoids duplicating the transform layer and keeps the right-click menu unified. Each provider can be enabled/disabled and trusted independently in settings, so you only see what you configure.

The plugin is intentionally scoped to **first-class clients** for these three apps; there is no generic "add any MCP server" UI yet, because no single integration shape works across arbitrary MCP servers. New providers will be added as first-class clients in future versions.

## Features

### Export as pure Markdown

Transform Obsidian-specific syntax into portable Markdown that works anywhere:

- **Copy as pure Markdown** — transform the active note and copy to clipboard.
- **Export to folder** — write transformed notes to a configurable export directory.

#### Transform options

| Option | Description | Default |
|--------|-------------|---------|
| Resolve `[[wikilinks]]` | Convert wikilinks to standard Markdown links | On |
| Embed handling | What to do with `![[embeds]]` | Replace with link |
| Flatten callouts | Convert `> [!note]` callouts to blockquotes | On |
| Drop frontmatter | Remove YAML frontmatter from output | Off |
| Rewrite attachments | How to handle image/attachment paths | Vault-relative |

### Bear (macOS / iOS)

- **Send active note to Bear** — dispatched via `bear://x-callback-url/create`. Tags from frontmatter are preserved.
- **Import from Bear** — enter a note UUID or Bear URL; the plugin opens Bear and writes the returned content into your vault.

### WPS Cloud Note (desktop)

Send notes to WPS Cloud Note via the WPS Note CLI or its MCP server endpoint. Configure transport, command path, and headers in settings.

### Youdao Note (desktop)

Send notes to Youdao Note via the official `youdaonote` CLI. The plugin can detect the CLI, push your API key to it, and run a connection test from settings.

### Context menu

Right-click any file in the file explorer (or select multiple files) to find the **Cross-App Notes Bridge** submenu with all available actions.

## Settings

Configure via **Settings → Community plugins → Cross-App Notes Bridge**.

- **Export folder** — directory for exported notes (default: `Exports`)
- **Import folder** — directory for imported notes (default: `Imports`)
- **Concurrency** — parallel export workers (default: 4)
- **Transform options** — configure Markdown output format
- **Providers** — enable, trust, and configure Bear / WPS / Youdao independently

## Commands

| Command | Description |
|---------|-------------|
| `Copy as pure Markdown` | Transform and copy the active note to clipboard |
| `Export current note as pure Markdown` | Export the active note to folder |
| `Send active note to Bear` | Dispatch the active note to Bear |
| `Import from Bear` | Import a Bear note via UUID or URL |
| `Send active note to WPS Cloud Note` | Dispatch the active note to a configured WPS provider |
| `Send active note to Youdao Note` | Dispatch the active note to a configured Youdao provider |

## Installation

### From GitHub release

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/huangcheng/obsidian-advanced-import-export/releases).
2. Copy them into `<vault>/.obsidian/plugins/advanced-import-export/`.
3. Enable the plugin in **Settings → Community plugins**.

### Build from source

```bash
git clone https://github.com/huangcheng/obsidian-advanced-import-export.git
cd obsidian-advanced-import-export
npm install
npm run build
```

Copy the output files (`main.js`, `manifest.json`, `styles.css`) into your vault's plugin directory.

## Development

```bash
npm install        # install dependencies
npm run dev        # watch mode — auto-rebuild on changes
npm run build      # production build
npm run lint       # run ESLint
```

## License

[MIT](LICENSE)
