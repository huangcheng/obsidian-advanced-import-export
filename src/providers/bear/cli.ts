import { Platform } from "obsidian";
import { NormalizedNote, RemoteListItem } from "../provider";
import { CliMissingError, runChild } from "../../util/subprocess";

export const DEFAULT_BEARCLI_PATH = "/Applications/Bear.app/Contents/MacOS/bearcli";

export interface BearCliCreateInput {
	title: string;
	body: string;
	tags: string[];
}

export interface BearCliListOptions {
	query?: string;
	limit?: number;
}

interface BearCliErrorPayload {
	error?: { code?: string; message?: string };
}

interface BearCliCreateRow {
	id?: string;
	title?: string;
	tags?: string[] | string;
}

interface BearCliShowRow extends BearCliCreateRow {
	content?: string;
	created?: string;
	modified?: string;
	locked?: boolean;
}

interface BearCliListRow {
	id?: string;
	title?: string;
	modified?: string;
}

function tryParseJson<T>(text: string): T | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed) as T;
	} catch {
		return null;
	}
}

function assertCliOk<T>(parsed: T | (T & BearCliErrorPayload) | null, fallbackMessage: string): T {
	if (parsed && typeof parsed === "object" && "error" in parsed && (parsed as BearCliErrorPayload).error) {
		const e = (parsed as BearCliErrorPayload).error!;
		throw new Error(e.message ?? e.code ?? fallbackMessage);
	}
	if (!parsed) throw new Error(fallbackMessage);
	return parsed as T;
}

function ensureDesktop(): void {
	if (!Platform.isDesktop) {
		throw new Error("bearcli requires Obsidian Desktop");
	}
}

function normaliseTags(raw: BearCliShowRow["tags"]): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) return raw.map(String);
	return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

export async function bearCliVersion(
	binPath: string,
): Promise<{ ok: boolean; version?: string; message?: string }> {
	if (!Platform.isDesktop) {
		return { ok: false, message: "bearcli requires Obsidian Desktop" };
	}
	try {
		const result = await runChild(binPath, ["--version"]);
		if (result.code === 0) {
			const text = (result.stdout || result.stderr).trim();
			const match = text.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/);
			return { ok: true, version: match?.[0] ?? text };
		}
		return { ok: false, message: result.stderr.trim() || `bearcli --version exited with ${result.code}` };
	} catch (err) {
		if (err instanceof CliMissingError) return { ok: false, message: err.message };
		return { ok: false, message: err instanceof Error ? err.message : String(err) };
	}
}

export async function bearCliCreate(
	binPath: string,
	input: BearCliCreateInput,
): Promise<{ remoteId: string }> {
	ensureDesktop();
	const args = ["create"];
	if (input.title) args.push(input.title);
	if (input.tags.length > 0) {
		args.push("--tags", input.tags.join(","));
	}
	args.push("--format", "json", "--fields", "id");
	const result = await runChild(binPath, args, { stdin: input.body });
	if (result.code !== 0) {
		const stderr = result.stderr.trim();
		const parsed = tryParseJson<BearCliErrorPayload>(result.stdout);
		const errMsg = parsed?.error?.message ?? stderr ?? `bearcli create exited with ${result.code}`;
		throw new Error(errMsg);
	}
	const row = assertCliOk(
		tryParseJson<BearCliCreateRow & BearCliErrorPayload>(result.stdout),
		"bearcli create returned no output",
	);
	return { remoteId: row.id ?? "" };
}

export async function bearCliShow(
	binPath: string,
	remoteId: string,
): Promise<NormalizedNote> {
	ensureDesktop();
	const result = await runChild(binPath, [
		"show",
		remoteId,
		"--fields",
		"all,content",
		"--format",
		"json",
	]);
	if (result.code !== 0) {
		const parsed = tryParseJson<BearCliErrorPayload>(result.stdout);
		throw new Error(
			parsed?.error?.message ?? (result.stderr.trim() || `bearcli show exited with ${result.code}`),
		);
	}
	const row = assertCliOk(
		tryParseJson<BearCliShowRow & BearCliErrorPayload>(result.stdout),
		"bearcli show returned no output",
	);
	return {
		remoteId: row.id ?? remoteId,
		title: row.title ?? "",
		body: row.content ?? "",
		tags: normaliseTags(row.tags),
		attachments: [],
		sourceMeta: {
			provider: "bear",
			created: row.created,
			modified: row.modified,
		},
	};
}

export async function bearCliList(
	binPath: string,
	opts: BearCliListOptions = {},
): Promise<RemoteListItem[]> {
	ensureDesktop();
	const limit = opts.limit && opts.limit > 0 ? String(opts.limit) : "50";
	const args = opts.query
		? ["search", opts.query, "--format", "json", "-n", limit]
		: ["list", "--format", "json", "-n", limit];
	const result = await runChild(binPath, args);
	if (result.code !== 0) {
		const parsed = tryParseJson<BearCliErrorPayload>(result.stdout);
		throw new Error(
			parsed?.error?.message ?? (result.stderr.trim() || `bearcli list exited with ${result.code}`),
		);
	}
	const rows = tryParseJson<BearCliListRow[]>(result.stdout) ?? [];
	return rows
		.filter((r) => typeof r.id === "string")
		.map((r) => ({
			remoteId: r.id ?? "",
			title: r.title ?? "",
			updatedAt: r.modified,
		}));
}
