import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type AdvancedImportExportPlugin from "../main";
import { BearProvider, BearProviderConfig } from "../providers/bear/bear-provider";
import { ProviderConfigBase } from "../providers/registry";
import { WpsProvider } from "../providers/wps/wps-provider";
import { WpsProviderConfig } from "../providers/wps/types";
import { YoudaoProvider } from "../providers/youdao/youdao-provider";
import { BEAR_NAME, WPS_NAME, YOUDAO_NAME } from "../ui/brand-names";
import {
	YOUDAO_API_KEY_URL,
	YOUDAO_INSTALL_CMD,
	YOUDAO_INSTALL_GUIDE,
	YoudaoProviderConfig,
} from "../providers/youdao/types";

/**
 * Settings tab. Sections grow as adapters land — for the foundation we
 * expose the transform toggles, default export destination, concurrency,
 * developer log, and a placeholder for providers (UI lives in
 * `providers/registry-ui.ts` once adapters are implemented).
 */
export class AdvancedImportExportSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: AdvancedImportExportPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setHeading().setName("Markdown export transforms");
		const t = this.plugin.settings.transform;

		new Setting(containerEl)
			.setName("Resolve wikilinks")
			.setDesc("Rewrite `[[note]]` to `[note](note.md)`. disable to keep wikilinks verbatim.")
			.addToggle((tog) =>
				tog.setValue(t.resolveWikilinks).onChange(async (v) => {
					t.resolveWikilinks = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Embed handling")
			.setDesc("How to render ![[...]] embeds in exported Markdown.")
			.addDropdown((dd) =>
				dd
					.addOptions({
						drop: "Drop",
						"replace-with-link": "Replace with link",
						"inline-image-link": "Inline as image link",
					})
					.setValue(t.embedHandling)
					.onChange(async (v) => {
						t.embedHandling = v as typeof t.embedHandling;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Flatten callouts")
			.setDesc("Convert `> [!note] Title` to a plain blockquote with bold title.")
			.addToggle((tog) =>
				tog.setValue(t.flattenCallouts).onChange(async (v) => {
					t.flattenCallouts = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Drop frontmatter")
			.setDesc("Remove the leading YAML frontmatter block from exported Markdown.")
			.addToggle((tog) =>
				tog.setValue(t.dropFrontmatter).onChange(async (v) => {
					t.dropFrontmatter = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Attachment links")
			.setDesc("How to rewrite paths to attachments referenced by embeds.")
			.addDropdown((dd) =>
				dd
					.addOptions({
						"vault-relative": "Vault-relative",
						absolute: "Absolute filesystem path",
						"upload-placeholder": "Upload placeholder (attachment://)",
					})
					.setValue(t.rewriteAttachments)
					.onChange(async (v) => {
						t.rewriteAttachments = v as typeof t.rewriteAttachments;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setHeading().setName("File locations");

		new Setting(containerEl)
			.setName("Default export folder")
			.setDesc("Vault-relative folder used by `Export as pure Markdown`.")
			.addText((text) =>
				text
					.setPlaceholder("Exports")
					.setValue(this.plugin.settings.defaultExportDir)
					.onChange(async (v) => {
						this.plugin.settings.defaultExportDir = v.trim() || "Exports";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default import folder")
			.setDesc("Folder for incoming notes, relative to the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Imports")
					.setValue(this.plugin.settings.defaultImportDir)
					.onChange(async (v) => {
						this.plugin.settings.defaultImportDir = v.trim() || "Imports";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Concurrency")
			.setDesc("Maximum number of provider operations to run in parallel (1-16).")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.concurrency))
					.onChange(async (v) => {
						const n = Number.parseInt(v, 10);
						if (Number.isFinite(n) && n >= 1 && n <= 16) {
							this.plugin.settings.concurrency = n;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Developer log")
			.setDesc("Print verbose diagnostics to the developer console (avoids secrets).")
			.addToggle((tog) =>
				tog.setValue(this.plugin.settings.developerLog).onChange(async (v) => {
					this.plugin.settings.developerLog = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setHeading().setName("Providers");
		containerEl.createEl("p", {
			text: `Configure note-source integrations for ${BEAR_NAME}, ${WPS_NAME}, and ${YOUDAO_NAME}. Each provider exposes import / export operations to the plugin's commands and the file-explorer right-click menu.`,
		});

		for (const cfg of this.plugin.settings.providers) {
			this.renderProviderCard(containerEl, cfg);
		}
	}

	private renderProviderCard(containerEl: HTMLElement, config: ProviderConfigBase): void {
		switch (config.kind) {
			case "bear":
				this.renderBearProvider(containerEl, config as BearProviderConfig);
				return;
			case "wps":
				this.renderWpsProvider(containerEl, config as WpsProviderConfig);
				return;
			case "youdao":
				this.renderYoudaoProvider(containerEl, config as YoudaoProviderConfig);
				return;
			default:
				containerEl.createEl("p", {
					text: `Unknown provider kind: ${config.kind} (${config.displayName})`,
				});
		}
	}

	/**
	 * Wrap a provider card in a native <details> element so users can
	 * collapse it. Untrusted (i.e. not-yet-configured) providers stay
	 * open so the config form is visible immediately after add.
	 */
	private openCollapsibleCard(
		parentEl: HTMLElement,
		title: string,
		config: ProviderConfigBase,
	): HTMLElement {
		const details = parentEl.createEl("details", { cls: "aie-provider-card" });
		if (!config.trusted) details.open = true;
		const summary = details.createEl("summary");
		const label = summary.createEl("strong", { text: title });
		void label;
		const flags: string[] = [];
		if (!config.enabled) flags.push("disabled");
		if (!config.trusted) flags.push("untrusted");
		if (flags.length > 0) {
			summary.appendText(` — ${flags.join(", ")}`);
		}
		return details.createDiv({ cls: "aie-provider-body" });
	}

	private renderWpsProvider(parentEl: HTMLElement, config: WpsProviderConfig): void {
		const containerEl = this.openCollapsibleCard(
			parentEl,
			config.displayName || "WPS Cloud Note",
			config,
		);
		const desc = containerEl.createEl("p");
		desc.setText(
			`Connect to ${WPS_NAME} via its server endpoint or the local CLI. Desktop Obsidian only for CLI.`,
		);

		new Setting(containerEl).setName("Display name").addText((text) =>
			text.setValue(config.displayName).onChange(async (v) => {
				config.displayName = v.trim() || "WPS Cloud Note";
				await this.plugin.saveSettings();
			}),
		);

		new Setting(containerEl)
			.setName("Transport")
			.setDesc(`Choose how the plugin reaches ${WPS_NAME}.`)
			.addDropdown((dd) =>
				dd
					.addOptions({ mcp: "MCP server", cli: "wpsnote-cli (CLI)" })
					.setValue(config.transport)
					.onChange(async (v) => {
						config.transport = v as WpsProviderConfig["transport"];
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (config.transport === "mcp") {
			if (!config.mcp) config.mcp = { transportType: "http", url: "", headers: {} };
			const mcp = config.mcp;

			new Setting(containerEl)
				.setName("Server transport")
				.addDropdown((dd) =>
					dd
						.addOptions({ http: "HTTP", stdio: "Stdio" })
						.setValue(mcp.transportType ?? "http")
						.onChange(async (v) => {
							mcp.transportType = v as "http" | "stdio";
							await this.plugin.saveSettings();
							this.display();
						}),
				);

			if ((mcp.transportType ?? "http") === "http") {
				new Setting(containerEl)
					.setName("URL")
					.addText((text) =>
						text
							.setValue(mcp.url ?? "")
							.onChange(async (v) => {
								mcp.url = v.trim();
								await this.plugin.saveSettings();
							}),
					);
				new Setting(containerEl)
					.setName("Headers")
					.setDesc("Optional HTTP headers as JSON (e.g. { \"Authorization\": \"Bearer ...\" })")
					.addTextArea((ta) =>
						ta
							.setValue(JSON.stringify(mcp.headers ?? {}, null, 2))
							.onChange(async (v) => {
								try {
									mcp.headers = JSON.parse(v || "{}") as Record<string, string>;
									await this.plugin.saveSettings();
								} catch {
									void 0;
								}
							}),
					);
			} else {
				new Setting(containerEl).setName("Command").addText((text) =>
					text
						.setValue(mcp.command ?? "")
						.onChange(async (v) => {
							mcp.command = v.trim();
							await this.plugin.saveSettings();
						}),
				);
				new Setting(containerEl)
					.setName("Args")
					.setDesc("Space-separated arguments")
					.addText((text) =>
						text
							.setValue((mcp.args ?? []).join(" "))
							.onChange(async (v) => {
								mcp.args = v.trim() ? v.trim().split(/\s+/) : [];
								await this.plugin.saveSettings();
							}),
					);
			}
		} else {
			if (!config.cli) config.cli = { binPath: "wpsnote-cli" };
			const cli = config.cli;
			new Setting(containerEl)
				.setName("CLI binary")
				.setDesc(`Path to the ${WPS_NAME} CLI binary. Leave as default to resolve via system path.`)
				.addText((text) =>
					text
						.setValue(cli.binPath ?? "")
						.onChange(async (v) => {
							cli.binPath = v.trim();
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl).setName("Enabled").addToggle((tog) =>
			tog.setValue(config.enabled).onChange(async (v) => {
				config.enabled = v;
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl)
			.setName("Trusted")
			.setDesc("Allow this provider to read and write notes.")
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
					const provider = this.plugin.registry.get(config.id) as WpsProvider | null;
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

	private renderYoudaoProvider(parentEl: HTMLElement, config: YoudaoProviderConfig): void {
		const containerEl = this.openCollapsibleCard(
			parentEl,
			config.displayName || "Youdao Note",
			config,
		);
		const intro = containerEl.createEl("p");
		intro.appendText("Connects to Youdao Note via its official CLI. Desktop only. ");
		intro.createEl("a", {
			text: "Get API key",
			href: YOUDAO_API_KEY_URL,
		}).setAttr("target", "_blank");

		new Setting(containerEl).setName("Display name").addText((text) =>
			text.setValue(config.displayName).onChange(async (v) => {
				config.displayName = v.trim() || "Youdao Note";
				await this.plugin.saveSettings();
			}),
		);

		new Setting(containerEl)
			.setName("CLI binary")
			.setDesc(`Path to the ${YOUDAO_NAME} CLI binary. Leave as default to resolve via system path.`)
			.addText((text) =>
				text
					.setValue(config.cliPath ?? "")
					.onChange(async (v) => {
						config.cliPath = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("API key")
			.setDesc("Stored only locally. The plugin pushes it to the CLI via `youdaonote config set apiKey`.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(config.apiKey ?? "").onChange(async (v) => {
					config.apiKey = v;
					await this.plugin.saveSettings();
				});
			})
			.addButton((btn) =>
				btn.setButtonText("Save to CLI").onClick(async () => {
					if (!config.apiKey) {
						new Notice("Enter an API key first.");
						return;
					}
					const provider = this.plugin.registry.get(config.id) as YoudaoProvider | null;
					if (!provider) {
						new Notice("Enable + trust the provider first, then retry.");
						return;
					}
					const result = await provider.setApiKey(config.apiKey);
					new Notice(result.message ?? (result.ok ? "API key saved" : "Failed to save API key"));
				}),
			);

		new Setting(containerEl)
			.setName("Default folder ID")
			.setDesc("Optional. Folder ID under which new notes are saved. Leave empty for the default folder.")
			.addText((text) =>
				text
					.setValue(config.defaultFolderId ?? "")
					.onChange(async (v) => {
						config.defaultFolderId = v.trim() || undefined;
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
			.setDesc("Allow this provider to read and write notes via the CLI.")
			.addToggle((tog) =>
				tog.setValue(config.trusted).onChange(async (v) => {
					config.trusted = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Detect CLI")
			.setDesc("Verify that youdaonote is installed and executable.")
			.addButton((btn) =>
				btn.setButtonText("Detect").onClick(async () => {
					const provider = this.plugin.registry.get(config.id) as YoudaoProvider | null;
					if (!provider) {
						new Notice("Enable + trust the provider first, then retry.");
						return;
					}
					const result = await provider.detectCli();
					if (result.installed) {
						new Notice(
							`Found ${result.version ?? "youdaonote"}${result.resolvedPath ? ` at ${result.resolvedPath}` : ""}`,
							8000,
						);
					} else {
						this.showYoudaoInstallNotice(result.message ?? "youdaonote not found");
					}
				}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.addButton((btn) =>
				btn.setButtonText("Test").onClick(async () => {
					const provider = this.plugin.registry.get(config.id) as YoudaoProvider | null;
					if (!provider) {
						new Notice("Enable + trust the provider first, then retry.");
						return;
					}
					const notice = new Notice("Testing connection...", 0);
					const result = await provider.testConnection?.();
					notice.hide();
					new Notice(result?.message ?? (result?.ok ? "Connected" : "Failed"));
				}),
			);
	}

	private showYoudaoInstallNotice(reason: string): void {
		new Notice(
			`${reason}\nInstall: ${YOUDAO_INSTALL_CMD}\nWindows: ${YOUDAO_INSTALL_GUIDE}`,
			15000,
		);
	}

	private renderBearProvider(containerEl: HTMLElement, config: BearProviderConfig): void {
		new Setting(containerEl).setHeading().setName(config.displayName || "Bear");
		containerEl.createEl("p", {
			text: `${BEAR_NAME} notes are reached via the app's URL scheme (macOS and iOS only); no credentials needed.`,
		});

		new Setting(containerEl)
			.setName("Display name")
			.addText((text) =>
				text.setValue(config.displayName).onChange(async (v) => {
					config.displayName = v.trim() || "Bear";
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Enabled")
			.setDesc(`Show ${BEAR_NAME} in commands and the file-explorer submenu.`)
			.addToggle((tog) =>
				tog.setValue(config.enabled).onChange(async (v) => {
					config.enabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Trusted")
			.setDesc(`Allow ${BEAR_NAME} to send and receive notes via callback URL.`)
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
					const provider = this.plugin.registry.get(config.id) as BearProvider | null;
					if (!provider) {
						new Notice("Bear provider isn't registered. Enable + trust it first, then save.");
						return;
					}
					const result = await provider.testConnection?.();
					new Notice(result?.message ?? (result?.ok ? "Bear is reachable" : "Bear is not available"));
				}),
			);
	}

}
