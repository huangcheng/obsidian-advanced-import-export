# Advanced Import / Export

An [Obsidian](https://obsidian.md) plugin for exporting and importing notes with portable Markdown transforms and integrations with external note-taking apps.

**Desktop only** — requires Obsidian v1.4.0+.

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

### Bear integration (macOS)

**Export to Bear** — send notes to Bear via `bear://x-callback-url/create`. Tags from frontmatter are preserved.

**Import from Bear** — enter a Bear note UUID or URL (e.g. `bear://x-callback-url/open-note?id=...`), and the plugin fetches the note via Bear's x-callback-url and writes it into your vault.

### Context menu

Right-click any file in the file explorer (or select multiple files) to find the **Advanced Import/Export** submenu with all available actions.

## Settings

Configure via **Settings → Community plugins → Advanced Import/Export**.

- **Export folder** — directory for exported notes (default: `Exports`)
- **Import folder** — directory for imported notes (default: `Imports`)
- **Concurrency** — parallel export workers (default: 4)
- **Transform options** — configure Markdown output format

## Commands

| Command | Description |
|---------|-------------|
| `Copy as pure Markdown` | Transform and copy active note to clipboard |
| `Export current note as pure Markdown` | Export active note to folder |
| `Export current note to Bear` | Send active note to Bear |
| `Import from Bear` | Import a note from Bear via UUID or URL |

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
