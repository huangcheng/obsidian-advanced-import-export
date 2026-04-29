import { Menu, MenuItem, Notice, ObsidianProtocolData, Plugin, TAbstractFile, TFile } from "obsidian";
import { Orchestrator } from "./orchestrator/orchestrator";
import { planExport, writeExports } from "./orchestrator/file-writer";
import { BearProvider } from "./providers/bear/bear-provider";
import { tagsFromFrontmatter } from "./providers/bear/export";
import { writeImportedNote } from "./providers/bear/import";
import { bearAvailable, parseBearInput } from "./providers/bear/url-scheme";
import { registerAllFactories } from "./providers/factories";
import { ProviderRegistry } from "./providers/registry";
import { WpsProvider } from "./providers/wps/wps-provider";
import { WpsProviderConfig } from "./providers/wps/types";
import { YoudaoProvider } from "./providers/youdao/youdao-provider";
import { YoudaoProviderConfig } from "./providers/youdao/types";
import { selectionFromActiveEditor, selectionFromFileMenu, selectionFromFiles } from "./selection/builders";
import { NoteSelection } from "./selection/note-selection";
import { applyDefaultProviderMigration, DEFAULT_SETTINGS, PluginSettings } from "./settings";
import { AdvancedImportExportSettingTab } from "./settings/settings-tab";
import { MarkdownTransformer } from "./transforms/transformer";
import { BEAR_NAME, PLUGIN_NAME, WPS_NAME, YOUDAO_NAME } from "./ui/brand-names";
import { ExportConfirmModal } from "./ui/export-confirm-modal";
import { BearImportModal } from "./ui/bear-import-modal";

export default class AdvancedImportExportPlugin extends Plugin {
	settings!: PluginSettings;
	registry!: ProviderRegistry;
	orchestrator!: Orchestrator;
	private bearImportModal: BearImportModal | null = null;

	async onload(): Promise<void> {
		this.registry = new ProviderRegistry();
		registerAllFactories(this.registry);
		await this.loadSettings();
		this.registry.loadConfigs(this.settings.providers);
		this.orchestrator = new Orchestrator({
			app: this.app,
			concurrency: this.settings.concurrency,
		});

		this.addCommand({
			id: "copy-as-pure-markdown",
			name: "Copy as pure Markdown",
			checkCallback: (checking) => {
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.copyAsPureMarkdown(sel);
				return true;
			},
		});

		this.addCommand({
			id: "export-as-pure-markdown-active",
			name: "Export current note as pure Markdown",
			checkCallback: (checking) => {
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.exportSelection(sel);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				const sel = selectionFromFileMenu(file);
				if (sel.notes.length === 0) return;
				this.addPluginSubmenu(menu, sel);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("files-menu", (menu: Menu, files: TAbstractFile[]) => {
				const tFiles = files.filter((f): f is TFile => f instanceof TFile);
				const sel = selectionFromFiles(tFiles);
				if (sel.notes.length === 0) return;
				this.addPluginSubmenu(menu, sel);
			}),
		);

		this.addSettingTab(new AdvancedImportExportSettingTab(this.app, this));

		this.addCommand({
			id: "export-active-to-bear",
			name: `Send active note to ${BEAR_NAME}`,
			checkCallback: (checking) => {
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.exportToBear(sel.notes);
				return true;
			},
		});

		this.addCommand({
			id: "import-from-bear",
			name: `Import from ${BEAR_NAME}`,
			callback: () => this.importFromBear(),
		});

		this.addCommand({
			id: "export-active-to-wps",
			name: `Send active note to ${WPS_NAME}…`,
			checkCallback: (checking) => {
				if (this.listWpsConfigs().length === 0) return false;
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.pickWpsAndExport(sel.notes);
				return true;
			},
		});

		this.addCommand({
			id: "export-active-to-youdao",
			name: `Send active note to ${YOUDAO_NAME}…`,
			checkCallback: (checking) => {
				if (this.listYoudaoConfigs().length === 0) return false;
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.pickYoudaoAndExport(sel.notes);
				return true;
			},
		});

		this.registerObsidianProtocolHandler("bear-callback", (data) => this.handleBearUri(data));
	}

	onunload(): void {
		this.registry.disposeAll();
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PluginSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(raw ?? {}),
			transform: { ...DEFAULT_SETTINGS.transform, ...(raw?.transform ?? {}) },
			providers: raw?.providers ?? [],
			mcpServers: raw?.mcpServers ?? [],
		};
		applyDefaultProviderMigration(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Some settings affect long-lived components.
		this.orchestrator = new Orchestrator({
			app: this.app,
			concurrency: this.settings.concurrency,
		});
		this.registry.loadConfigs(this.settings.providers);
	}

	private buildTransformer(): MarkdownTransformer {
		return new MarkdownTransformer(this.app, this.settings.transform);
	}

	private async copyAsPureMarkdown(selection: NoteSelection): Promise<void> {
		const file = selection.notes[0];
		if (!file) {
			new Notice("No active note to copy");
			return;
		}
		const transformer = this.buildTransformer();
		const source = await this.app.vault.cachedRead(file);
		const { output } = transformer.run({ source, file });
		try {
			await navigator.clipboard.writeText(output);
			new Notice("Copied as pure Markdown");
		} catch (err) {
			new Notice(`Clipboard write failed: ${errorMessage(err)}`);
		}
	}

	private async exportSelection(selection: NoteSelection): Promise<void> {
		if (selection.notes.length === 0) {
			new Notice("No Markdown notes selected");
			return;
		}
		const transformer = this.buildTransformer();
		const plans = await planExport(this.app, transformer, selection.notes);
		new ExportConfirmModal(this.app, plans, this.settings.defaultExportDir, (result) => {
			void (async () => {
				if (!result.confirmed) return;
				const summary = await writeExports(this.app, plans, {
					files: selection.notes,
					destinationDir: result.destinationDir,
					copyAttachments: false,
					collisionPolicy: "rename",
				});
				new Notice(
					`Export complete: ${summary.written.length} written, ${summary.skipped.length} skipped, ${summary.failed.length} failed`,
				);
			})();
		}).open();
	}

	private getBearProvider(): BearProvider | null {
		const provider = this.registry.get("bear");
		if (!provider) return null;
		return provider as BearProvider;
	}

	private async exportToBear(files: TFile[]): Promise<void> {
		if (files.length === 0) {
			new Notice("No notes to export");
			return;
		}
		const provider = this.getBearProvider();
		if (!provider) {
 new Notice("Bear provider is not configured. Enable it in settings → providers.");
			return;
		}
		const avail = provider.available?.() ?? { ok: true };
		if (!avail.ok) {
			new Notice(avail.reason ?? "Bear is unavailable");
			return;
		}
		const transformer = this.buildTransformer();
		let dispatched = 0;
		let failed = 0;
		for (const file of files) {
			try {
				const source = await this.app.vault.cachedRead(file);
				const { output } = transformer.run({ source, file });
				const tags = tagsFromFrontmatter(this.app, file);
				await provider.push({
					remoteId: "",
					title: file.basename,
					body: output,
					tags,
					attachments: [],
					sourceMeta: {},
				});
				dispatched++;
			} catch {
				failed++;
			}
		}
		if (failed === 0) {
			new Notice(`Exported ${dispatched} note${dispatched !== 1 ? "s" : ""} to Bear`);
		} else {
			new Notice(`Bear export: ${dispatched} sent, ${failed} failed.`);
		}
	}

	private importFromBear(): void {
		const provider = this.getBearProvider();
		if (!provider) {
			new Notice("Bear provider is not configured. Enable it in settings → providers.");
			return;
		}
		const avail = provider.available?.() ?? { ok: true };
		if (!avail.ok) {
			new Notice(avail.reason ?? "Bear is unavailable");
			return;
		}
		this.bearImportModal = new BearImportModal(this.app, (request) => {
			void (async () => {
				const noteId = parseBearInput(request.noteId);
				if (!noteId) {
					new Notice(`Invalid ${BEAR_NAME} identifier — enter a UUID or URL.`);
					return;
				}
				this.bearImportModal?.setWaiting();
				try {
					const note = await provider.fetch(noteId);
					const path = await writeImportedNote(this.app, note, this.settings.defaultImportDir);
					this.bearImportModal?.setDone(true, `Note imported to ${path}`);
					new Notice(`Imported "${note.title}" to ${path}`);
				} catch (err) {
					const msg = errorMessage(err);
					this.bearImportModal?.setDone(false, msg);
					new Notice(`Bear import failed: ${msg}`);
				}
			})();
		});
		this.bearImportModal.open();
	}

	private handleBearUri(data: ObsidianProtocolData): void {
		const search = Object.entries(data)
			.filter(([key]) => key !== "action")
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join("&");
		const provider = this.getBearProvider();
		if (!provider) return;
		provider.handleCallback(search);
	}


	private addPluginSubmenu(menu: Menu, selection: NoteSelection): void {
		const { notes } = selection;
		if (notes.length === 0) return;

		menu.addItem((item) => {
			item.setTitle(`${PLUGIN_NAME}`).setIcon("lucide-arrow-left-right");
			const sub = (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();

			if (notes.length === 1) {
				sub.addItem((s) =>
					s
						.setTitle("Copy as pure Markdown")
						.setIcon("clipboard-copy")
						.onClick(() => void this.copyAsPureMarkdown(selection)),
				);
			}

			this.addBearSubmenu(sub, notes);
			this.addWpsSubmenus(sub, notes);
			this.addYoudaoSubmenus(sub, notes);
		});
	}

	private addBearSubmenu(menu: Menu, files: TFile[]): void {
		if (files.length === 0) return;
		const macOnly = !bearAvailable();
		menu.addItem((item) => {
			item.setTitle(`${BEAR_NAME}`).setIcon("book-open");
			const submenu = (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();
			submenu.addItem((sub: MenuItem) =>
				sub
					.setTitle(
						files.length === 1
							? `Send note to ${BEAR_NAME}`
							: `Send ${files.length} notes to ${BEAR_NAME}`,
					)
					.setIcon("upload")
					.setDisabled(macOnly)
					.onClick(() => void this.exportToBear(files)),
			);
			submenu.addItem((sub: MenuItem) =>
				sub
					.setTitle(`Import from ${BEAR_NAME}…`)
					.setIcon("download")
					.setDisabled(macOnly)
					.onClick(() => this.importFromBear()),
			);
			if (macOnly) {
				submenu.addItem((sub: MenuItem) =>
					sub.setTitle(`(${BEAR_NAME} is macOS / iOS only)`).setDisabled(true),
				);
			}
		});
	}


	private addWpsSubmenus(menu: Menu, files: TFile[]): void {
		if (files.length === 0) return;
		const configs = this.listWpsConfigs();
		if (configs.length === 0) return;
		for (const config of configs) {
			const provider = this.registry.get(config.id) as WpsProvider | null;
			const avail = provider?.available?.() ?? { ok: false, reason: "Enable + trust this provider in Settings" };
			menu.addItem((item) => {
				item.setTitle(config.displayName).setIcon("file-text");
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

	private addYoudaoSubmenus(menu: Menu, files: TFile[]): void {
		if (files.length === 0) return;
		const configs = this.listYoudaoConfigs();
		if (configs.length === 0) return;
		for (const config of configs) {
			const provider = this.registry.get(config.id) as YoudaoProvider | null;
			const avail = provider?.available?.() ?? { ok: false, reason: "Enable + trust this provider in Settings" };
			menu.addItem((item) => {
				item.setTitle(config.displayName).setIcon("edit");
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


	private listWpsConfigs(): WpsProviderConfig[] {
		return this.settings.providers.filter(
			(p): p is WpsProviderConfig => p.kind === "wps" && p.enabled !== false,
		);
	}

	private listYoudaoConfigs(): YoudaoProviderConfig[] {
		return this.settings.providers.filter(
			(p): p is YoudaoProviderConfig => p.kind === "youdao" && p.enabled !== false,
		);
	}

	private async pickYoudaoAndExport(files: TFile[]): Promise<void> {
		const configs = this.listYoudaoConfigs();
		if (configs.length === 0) {
			new Notice(`No ${YOUDAO_NAME} providers configured`);
			return;
		}
		const target = configs.length === 1 ? configs[0]! : await this.pickProviderConfig(configs, "Select Youdao provider…");
		if (!target) return;
		await this.exportToProvider(target, files);
	}

	private async exportToProvider(
		config: WpsProviderConfig | YoudaoProviderConfig,
		files: TFile[],
	): Promise<void> {
		const provider = this.registry.get(config.id) as WpsProvider | YoudaoProvider | null;
		if (!provider) {
			new Notice(`${config.displayName} is not enabled or trusted in Settings.`);
			return;
		}
		const avail = provider.available?.() ?? { ok: true };
		if (!avail.ok) {
			new Notice(avail.reason ?? "Provider unavailable");
			return;
		}
		const transformer = this.buildTransformer();
		let succeeded = 0;
		const failures: { file: TFile; error: string }[] = [];
		for (const file of files) {
			try {
				const source = await this.app.vault.cachedRead(file);
				const { output } = transformer.run({ source, file });
				await provider.push({
					remoteId: "",
					title: file.basename,
					body: output,
					tags: tagsFromFrontmatter(this.app, file),
					attachments: [],
					sourceMeta: { source: "vault", path: file.path },
				});
				succeeded++;
			} catch (err) {
				const msg = errorMessage(err);
				failures.push({ file, error: msg });
				console.warn(`[${config.kind}] export failed for ${file.path}:`, err);
			}
		}
		if (failures.length === 0) {
			new Notice(
				`Exported ${succeeded} note${succeeded === 1 ? "" : "s"} to ${config.displayName}`,
			);
		} else {
			const firstReason = failures[0]?.error ?? "unknown";
			new Notice(
				`${config.displayName}: ${succeeded} succeeded, ${failures.length} failed — ${firstReason}`,
				12000,
			);
		}
	}

	private async pickWpsAndExport(files: TFile[]): Promise<void> {
		const configs = this.listWpsConfigs();
		if (configs.length === 0) {
			new Notice(`No ${WPS_NAME} providers configured`);
			return;
		}
		const target = configs.length === 1 ? configs[0]! : await this.pickProviderConfig(configs, "Select WPS provider…");
		if (!target) return;
		await this.exportToProvider(target, files);
	}

	private async pickProviderConfig<C extends { id: string; displayName: string }>(
		items: C[],
		placeholder: string,
	): Promise<C | null> {
		const { FuzzySuggestModal } = await import("obsidian");
		return new Promise((resolve) => {
			class Picker extends FuzzySuggestModal<C> {
				private chose = false;
				constructor(
					app: import("obsidian").App,
					private readonly entries: C[],
				) {
					super(app);
				}
				getItems(): C[] { return this.entries; }
				getItemText(item: C): string { return item.displayName; }
				onChooseItem(item: C): void {
					this.chose = true;
					resolve(item);
				}
				onClose(): void {
					if (!this.chose) resolve(null);
					super.onClose();
				}
			}
			const picker = new Picker(this.app, items);
			picker.setPlaceholder(placeholder);
			picker.open();
		});
	}
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
