import { BearProviderConfig, DEFAULT_BEAR_CONFIG } from "../providers/bear/bear-provider";
import { bearAvailable } from "../providers/bear/url-scheme";
import { DEFAULT_FLOMO_CONFIG, FlomoProviderConfig } from "../providers/flomo/types";
import { ProviderConfigBase } from "../providers/registry";
import { DEFAULT_WPS_CONFIG, WpsProviderConfig } from "../providers/wps/types";
import { DEFAULT_YOUDAO_CONFIG, YoudaoProviderConfig } from "../providers/youdao/types";
import { DEFAULT_TRANSFORM_CONFIG, TransformConfig } from "../transforms/config";

export type ProviderConfig =
	| BearProviderConfig
	| WpsProviderConfig
	| YoudaoProviderConfig
	| FlomoProviderConfig
	| ProviderConfigBase;

export interface PluginSettings {
	transform: TransformConfig;
	defaultExportDir: string;
	defaultImportDir: string;
	concurrency: number;
	developerLog: boolean;
	providers: ProviderConfig[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
	transform: { ...DEFAULT_TRANSFORM_CONFIG },
	defaultExportDir: "Exports",
	defaultImportDir: "Imports",
	concurrency: 4,
	developerLog: false,
	providers: [],
};

/**
 * Seed the providers list with the three first-class clients (Bear,
 * WPS, Youdao) on first load. Idempotent: existing user-configured
 * cards are preserved. Bear only appears on macOS/iOS where its
 * x-callback URL scheme works.
 */
export function applyDefaultProviderMigration(settings: PluginSettings): void {
	if (bearAvailable() && !settings.providers.some((p) => p.kind === "bear")) {
		const cfg: BearProviderConfig = {
			id: "bear",
			displayName: "Bear",
			...DEFAULT_BEAR_CONFIG,
		};
		settings.providers.push(cfg);
	}
	if (!settings.providers.some((p) => p.kind === "wps")) {
		const cfg: WpsProviderConfig = {
			id: "wps",
			displayName: "WPS Cloud Note",
			...DEFAULT_WPS_CONFIG,
		};
		settings.providers.push(cfg);
	}
	if (!settings.providers.some((p) => p.kind === "youdao")) {
		const cfg: YoudaoProviderConfig = {
			id: "youdao",
			displayName: "Youdao Note",
			...DEFAULT_YOUDAO_CONFIG,
		};
		settings.providers.push(cfg);
	}
	if (!settings.providers.some((p) => p.kind === "flomo")) {
		const cfg: FlomoProviderConfig = {
			id: "flomo",
			displayName: "Flomo",
			...DEFAULT_FLOMO_CONFIG,
		};
		settings.providers.push(cfg);
	}
}
