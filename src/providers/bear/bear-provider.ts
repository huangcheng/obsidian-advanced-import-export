import { Platform } from "obsidian";
import {
	FetchOptions,
	ListOptions,
	NormalizedNote,
	Provider,
	ProviderAvailability,
	ProviderCapabilities,
	RemoteListItem,
} from "../provider";
import { ProviderConfigBase, ProviderFactory } from "../registry";
import { expandHome } from "../../util/subprocess";
import { bearCliCreate, bearCliList, bearCliShow, bearCliVersion, DEFAULT_BEARCLI_PATH } from "./cli";
import { bearOpenDelayMs, delay, dispatchToBear } from "./export";
import { bearCallbackToNote, initiateBearImport } from "./import";
import { bearAvailable, parseBearCallback } from "./url-scheme";
import { t } from "../../i18n";

export type BearTransport = "auto" | "url" | "cli";

export interface BearCliTransportConfig {
	binPath?: string;
}

export interface BearProviderConfig extends ProviderConfigBase {
	kind: "bear";
	transport?: BearTransport;
	cli?: BearCliTransportConfig;
}

export const DEFAULT_BEAR_CONFIG: Omit<BearProviderConfig, "id" | "displayName"> = {
	kind: "bear",
	enabled: true,
	transport: "auto",
	cli: { binPath: DEFAULT_BEARCLI_PATH },
};

interface PendingFetch {
	resolve: (note: NormalizedNote) => void;
	reject: (err: Error) => void;
	timer: number;
	signalCleanup?: () => void;
}

const FETCH_TIMEOUT_MS = 60_000;

/**
 * Wraps Bear behind the `Provider` contract. Two transports:
 * - CLI (`bearcli`) — synchronous, supports list/search, no app focus steal.
 * - URL scheme (`bear://x-callback-url`) — fallback for older Bear builds and iOS.
 *
 * `transport: "auto"` (default) probes the CLI once on first use and
 * commits to whichever path works.
 */
export class BearProvider implements Provider {
	readonly id: string;
	readonly displayName: string;
	readonly icon = "book-open";
	readonly capabilities: ProviderCapabilities = {
		canImport: true,
		canExport: true,
		supportsBulk: true,
		supportsAttachments: false,
	};

	private readonly transport: BearTransport;
	private readonly cliBinPath: string;
	private cliReady: Promise<boolean> | null = null;

	private readonly pending = new Map<string, PendingFetch>();
	private dispatchQueue: Promise<void> = Promise.resolve();

	constructor(config: BearProviderConfig) {
		this.id = config.id;
		this.displayName = config.displayName || "Bear";
		this.transport = config.transport ?? "auto";
		const rawPath = config.cli?.binPath?.trim();
		this.cliBinPath = expandHome(rawPath || DEFAULT_BEARCLI_PATH);
	}

	available(): ProviderAvailability {
		return bearAvailable()
			? { ok: true }
			: { ok: false, reason: t("providers.unavailable", { provider: t("brands.bear") }) };
	}

	private async useCli(): Promise<boolean> {
		if (this.transport === "url") return false;
		if (!Platform.isDesktop) return false;
		if (this.transport === "cli") return true;
		this.cliReady ??= bearCliVersion(this.cliBinPath).then((r) => r.ok);
		return this.cliReady;
	}

	async push(note: NormalizedNote): Promise<{ remoteId: string }> {
		if (!bearAvailable()) {
			throw new Error(t("providers.unavailable", { provider: t("brands.bear") }));
		}
		if (await this.useCli()) {
			return bearCliCreate(this.cliBinPath, {
				title: note.title,
				body: note.body,
				tags: note.tags,
			});
		}
		const prev = this.dispatchQueue;
		let release: () => void = () => {};
		this.dispatchQueue = new Promise<void>((r) => {
			release = r;
		});
		await prev;
		try {
			dispatchToBear({
				title: note.title,
				body: note.body,
				tags: note.tags,
				openNote: false,
			});
			await delay(bearOpenDelayMs());
			return { remoteId: "" };
		} finally {
			release();
		}
	}

	async fetch(remoteId: string, opts?: FetchOptions): Promise<NormalizedNote> {
		if (!bearAvailable()) {
			throw new Error(t("providers.unavailable", { provider: t("brands.bear") }));
		}
		if (await this.useCli()) {
			return bearCliShow(this.cliBinPath, remoteId);
		}
		if (this.pending.has(remoteId)) {
			throw new Error(`Bear fetch already in progress for ${remoteId}`);
		}
		return new Promise<NormalizedNote>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.pending.delete(remoteId);
				reject(new Error(`Bear fetch timed out for ${remoteId}`));
			}, FETCH_TIMEOUT_MS);

			const entry: PendingFetch = { resolve, reject, timer };
			if (opts?.signal) {
				const onAbort = () => {
					this.pending.delete(remoteId);
					window.clearTimeout(timer);
					reject(new Error("Cancelled"));
				};
				opts.signal.addEventListener("abort", onAbort, { once: true });
				entry.signalCleanup = () =>
					opts.signal?.removeEventListener("abort", onAbort);
			}
			this.pending.set(remoteId, entry);
			initiateBearImport(remoteId);
		});
	}

	/**
	 * Resolve the in-flight URL-scheme fetch for the note Bear just round-tripped.
	 * No-op when CLI mode handled the fetch synchronously.
	 */
	handleCallback(searchParams: string): void {
		const parsed = parseBearCallback(searchParams);
		const id = parsed.identifier ?? "";

		let key: string | undefined;
		let entry = this.pending.get(id);
		if (entry) {
			key = id;
		} else if (this.pending.size === 1) {
			key = this.pending.keys().next().value as string;
			entry = this.pending.get(key);
		}
		if (!entry || key === undefined) return;

		this.pending.delete(key);
		window.clearTimeout(entry.timer);
		entry.signalCleanup?.();

		if (!parsed.success) {
			entry.reject(
				new Error(parsed.errorMessage ?? `Bear error ${parsed.errorCode ?? "unknown"}`),
			);
			return;
		}
		const note = bearCallbackToNote(parsed);
		if (!note) {
			entry.reject(new Error("Bear returned an empty note. The note may be encrypted."));
			return;
		}
		entry.resolve(note);
	}

	async listRemote(opts?: ListOptions): Promise<RemoteListItem[]> {
		if (await this.useCli()) {
			return bearCliList(this.cliBinPath, { query: opts?.query });
		}
		// URL-scheme has no list endpoint — BearImportModal asks for the id directly.
		return [];
	}

	async detectCli(): Promise<{
		installed: boolean;
		version?: string;
		resolvedPath?: string;
		message?: string;
	}> {
		if (!Platform.isDesktop) {
			return { installed: false, message: "bearcli requires Obsidian Desktop" };
		}
		const result = await bearCliVersion(this.cliBinPath);
		return result.ok
			? { installed: true, version: result.version, resolvedPath: this.cliBinPath }
			: { installed: false, resolvedPath: this.cliBinPath, message: result.message };
	}

	async testConnection(): Promise<{ ok: boolean; message?: string }> {
		if (!bearAvailable()) {
			return { ok: false, message: t("providers.unavailable", { provider: t("brands.bear") }) };
		}
		if (this.transport === "url") {
			return { ok: true, message: t("providers.connectionSuccess") };
		}
		if (await this.useCli()) {
			const result = await bearCliVersion(this.cliBinPath);
			return result.ok
				? { ok: true, message: t("providers.cliDetected", { version: result.version ?? "ok", path: ` ${this.cliBinPath}` }) }
				: { ok: false, message: result.message ?? t("providers.cliNotFound", { provider: "bearcli" }) };
		}
		if (this.transport === "cli") {
			return { ok: false, message: t("providers.cliNotFound", { provider: `bearcli at ${this.cliBinPath}` }) };
		}
		return { ok: true, message: t("providers.connectionSuccess") };
	}

	dispose(): void {
		for (const entry of this.pending.values()) {
		window.clearTimeout(entry.timer);
			entry.signalCleanup?.();
			entry.reject(new Error("BearProvider disposed"));
		}
		this.pending.clear();
	}
}

export const bearFactory: ProviderFactory<BearProviderConfig> = {
	kind: "bear",
	create(config) {
		return new BearProvider(config);
	},
};
