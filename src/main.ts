import { Menu, MenuItem, moment, Notice, ObsidianProtocolData, Plugin, TAbstractFile, TFile } from "obsidian";
import { initializeI18n, t } from "./i18n";
import { Orchestrator } from "./orchestrator/orchestrator";
import { planExport, writeExports } from "./orchestrator/file-writer";
import { BearProvider } from "./providers/bear/bear-provider";
import { tagsFromFrontmatter } from "./providers/bear/export";
import { writeImportedNote } from "./providers/bear/import";
import { bearAvailable, parseBearInput } from "./providers/bear/url-scheme";
import { FlomoProviderConfig } from "./providers/flomo/types";
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
import { FLOMO_NAME, WPS_NAME, YOUDAO_NAME } from "./ui/brand-names";
import { ExportConfirmModal } from "./ui/export-confirm-modal";
import { BearImportModal } from "./ui/bear-import-modal";

export default class AdvancedImportExportPlugin extends Plugin {
	settings!: PluginSettings;
	registry!: ProviderRegistry;
	orchestrator!: Orchestrator;
	private bearImportModal: BearImportModal | null = null;

	async onload(): Promise<void> {
		initializeI18n(moment.locale());
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
			name: t("commands.copyAsMarkdown"),
			checkCallback: (checking) => {
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.copyAsPureMarkdown(sel);
				return true;
			},
		});

		this.addCommand({
			id: "export-as-pure-markdown-active",
			name: t("commands.exportCurrentNote"),
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
			name: t("commands.sendToBear"),
			checkCallback: (checking) => {
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.exportToBear(sel.notes);
				return true;
			},
		});

		this.addCommand({
			id: "import-from-bear",
			name: t("commands.importFromBear"),
			callback: () => this.importFromBear(),
		});

		this.addCommand({
			id: "export-active-to-wps",
			name: t("commands.sendToWps"),
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
			name: t("commands.sendToYoudao"),
			checkCallback: (checking) => {
				if (this.listYoudaoConfigs().length === 0) return false;
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.pickYoudaoAndExport(sel.notes);
				return true;
			},
		});

		this.addCommand({
			id: "export-active-to-flomo",
			name: t("commands.sendToFlomo"),
			checkCallback: (checking) => {
				if (this.listFlomoConfigs().length === 0) return false;
				const sel = selectionFromActiveEditor(this.app);
				if (!sel || sel.notes.length === 0) return false;
				if (!checking) void this.pickFlomoAndExport(sel.notes);
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
			new Notice(t("notices.noActiveNote"));
			return;
		}
		const transformer = this.buildTransformer();
		const source = await this.app.vault.cachedRead(file);
		const { output } = transformer.run({ source, file });
		try {
			await navigator.clipboard.writeText(output);
			new Notice(t("notices.copied"));
		} catch (err) {
			new Notice(t("notices.clipboardFailed", { error: errorMessage(err) }));
		}
	}

	private async exportSelection(selection: NoteSelection): Promise<void> {
		if (selection.notes.length === 0) {
			new Notice(t("notices.noNotesSelected"));
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
					t("notices.exportComplete", { written: summary.written.length, skipped: summary.skipped.length, failed: summary.failed.length }),
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
			new Notice(t("notices.noNotesToExport"));
			return;
		}
		const provider = this.getBearProvider();
		if (!provider) {
 new Notice(t("notices.bearNotConfigured"));
			return;
		}
		const avail = provider.available?.() ?? { ok: true };
		if (!avail.ok) {
			new Notice(avail.reason ?? t("notices.bearUnavailable"));
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
			new Notice(t("notices.bearDispatched", { count: dispatched, s: dispatched !== 1 ? "s" : "" }));
		} else {
			new Notice(t("notices.bearPartialFail", { dispatched, failed }));
		}
	}

	private importFromBear(): void {
		const provider = this.getBearProvider();
		if (!provider) {
			new Notice(t("notices.bearNotConfigured"));
			return;
		}
		const avail = provider.available?.() ?? { ok: true };
		if (!avail.ok) {
			new Notice(avail.reason ?? t("notices.bearUnavailable"));
			return;
		}
		this.bearImportModal = new BearImportModal(this.app, (request) => {
			void (async () => {
				const noteId = parseBearInput(request.noteId);
				if (!noteId) {
					new Notice(t("notices.invalidBearId"));
					return;
				}
				this.bearImportModal?.setWaiting();
				try {
					const note = await provider.fetch(noteId);
					const path = await writeImportedNote(this.app, note, this.settings.defaultImportDir);
					this.bearImportModal?.setDone(true, `Note imported to ${path}`);
					new Notice(t("notices.bearImported", { title: note.title, path }));
				} catch (err) {
					const msg = errorMessage(err);
					this.bearImportModal?.setDone(false, msg);
					new Notice(t("notices.bearImportFailed", { error: msg }));
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
			item.setTitle(t("brands.plugin")).setIcon("lucide-arrow-left-right");
			const sub = (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();

			if (notes.length === 1) {
				sub.addItem((s) =>
					s
						.setTitle(t("commands.copyAsMarkdown"))
						.setIcon("clipboard-copy")
						.onClick(() => void this.copyAsPureMarkdown(selection)),
				);
			}

			this.addBearSubmenu(sub, notes);
			this.addWpsSubmenus(sub, notes);
			this.addYoudaoSubmenus(sub, notes);
			this.addFlomoSubmenus(sub, notes);
		});
	}

	private addBearSubmenu(menu: Menu, files: TFile[]): void {
		if (files.length === 0) return;
		const macOnly = !bearAvailable();
		menu.addItem((item) => {
			item.setTitle(t("brands.bear")).setIcon("book-open");
			const submenu = (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();
			submenu.addItem((sub: MenuItem) =>
				sub
					.setTitle(
						files.length === 1
							? t("commands.sendToBear")
							: `Send ${files.length} notes to ${t("brands.bear")}`,
					)
					.setIcon("upload")
					.setDisabled(macOnly)
					.onClick(() => void this.exportToBear(files)),
			);
			submenu.addItem((sub: MenuItem) =>
				sub
					.setTitle(`${t("commands.importFromBear")}…`)
					.setIcon("download")
					.setDisabled(macOnly)
					.onClick(() => this.importFromBear()),
			);
			if (macOnly) {
				submenu.addItem((sub: MenuItem) =>
					sub.setTitle(`(${t("brands.bear")} is macOS / iOS only)`).setDisabled(true),
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
			const avail = provider?.available?.() ?? { ok: false, reason: t("providers.enableInSettings") };
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
								new Notice(t("notices.exportFailed", { error: errorMessage(err) }));
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
			const avail = provider?.available?.() ?? { ok: false, reason: t("providers.enableInSettings") };
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
								new Notice(t("notices.exportFailed", { error: errorMessage(err) }));
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

	private addFlomoSubmenus(menu: Menu, files: TFile[]): void {
		if (files.length === 0) return;
		const configs = this.listFlomoConfigs();
		if (configs.length === 0) return;
		for (const config of configs) {
			const provider = this.registry.get(config.id);
			const avail = provider?.available?.() ?? { ok: false, reason: t("providers.enableInSettings") };
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
								new Notice(t("notices.exportFailed", { error: errorMessage(err) }));
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
			new Notice(t("notices.noProviderConfigured", { provider: YOUDAO_NAME }));
			return;
		}
		const target = configs.length === 1 ? configs[0]! : await this.pickProviderConfig(configs, t("notices.selectProvider", { provider: YOUDAO_NAME }));
		if (!target) return;
		await this.exportToProvider(target, files);
	}

	private listFlomoConfigs(): FlomoProviderConfig[] {
		return this.settings.providers.filter(
			(p): p is FlomoProviderConfig => p.kind === "flomo" && p.enabled !== false,
		);
	}

	private async pickFlomoAndExport(files: TFile[]): Promise<void> {
		const configs = this.listFlomoConfigs();
		if (configs.length === 0) {
			new Notice(t("notices.noProviderConfigured", { provider: FLOMO_NAME }));
			return;
		}
		const target = configs.length === 1 ? configs[0]! : await this.pickProviderConfig(configs, t("notices.selectProvider", { provider: FLOMO_NAME }));
		if (!target) return;
		await this.exportToProvider(target, files);
	}

	private async exportToProvider(
		config: WpsProviderConfig | YoudaoProviderConfig | FlomoProviderConfig,
		files: TFile[],
	): Promise<void> {
		const provider = this.registry.get(config.id);
		if (!provider) {
			new Notice(t("notices.providerNotEnabled", { provider: config.displayName }));
			return;
		}
		const avail = provider.available?.() ?? { ok: true };
		if (!avail.ok) {
			new Notice(avail.reason ?? t("notices.providerUnavailable", { provider: config.displayName }));
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
				t("notices.exportedTo", { count: succeeded, s: succeeded === 1 ? "" : "s", provider: config.displayName }),
			);
		} else {
			const firstReason = failures[0]?.error ?? "unknown";
			new Notice(
				t("notices.exportPartialFail", { provider: config.displayName, succeeded, failed: failures.length, reason: firstReason }),
				12000,
			);
		}
	}

	private async pickWpsAndExport(files: TFile[]): Promise<void> {
		const configs = this.listWpsConfigs();
		if (configs.length === 0) {
			new Notice(t("notices.noProviderConfigured", { provider: WPS_NAME }));
			return;
		}
		const target = configs.length === 1 ? configs[0]! : await this.pickProviderConfig(configs, t("notices.selectProvider", { provider: WPS_NAME }));
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
