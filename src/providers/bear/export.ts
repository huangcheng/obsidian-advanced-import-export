import { App, TFile } from "obsidian";
import { buildBearCreateUrl, openInBear } from "./url-scheme";

const BEAR_OPEN_DELAY_MS = 250;

export function bearOpenDelayMs(): number {
	return BEAR_OPEN_DELAY_MS;
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function tagsFromFrontmatter(app: App, file: TFile): string[] {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	const raw: unknown = fm?.tags;
	if (!raw) return [];
	if (Array.isArray(raw)) return (raw as unknown[]).filter((t): t is string => typeof t === "string");
	if (typeof raw === "string") {
		return raw
			.split(/[,\s]+/)
			.map((t) => t.trim())
			.filter((t) => t.length > 0);
	}
	return [];
}

export interface DispatchToBearParams {
	title: string;
	body: string;
	tags?: string[];
	openNote?: boolean;
}

export function dispatchToBear(params: DispatchToBearParams): void {
	const url = buildBearCreateUrl({
		title: params.title,
		body: params.body,
		tags: params.tags,
		openNote: params.openNote ?? false,
	});
	openInBear(url);
}
