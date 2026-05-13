import { Platform } from "obsidian";

export interface ChildResult {
	stdout: string;
	stderr: string;
	code: number | null;
}

export interface RunChildOptions {
	stdin?: string;
	signal?: AbortSignal;
	cwd?: string;
	/** Extra directories to prepend to PATH. */
	extraPathDirs?: string[];
}

export class CliMissingError extends Error {
	constructor(public readonly bin: string) {
		super(`CLI not found: ${bin}`);
		this.name = "CliMissingError";
	}
}

/**
 * Bin dirs we add to PATH on every spawn. GUI-launched Electron apps
 * (Obsidian) don't inherit the user's shell PATH, so binaries installed
 * by per-tool installers (Homebrew, ~/.local/bin) become invisible
 * unless we hint at them explicitly.
 */
const COMMON_BIN_DIRS = [
	"/usr/local/bin",
	"/opt/homebrew/bin",
	"/opt/local/bin",
];

/**
 * Resolve a Node built-in via the renderer's `require`. Dynamic
 * `import("child_process")` is mangled by some bundlers into a native
 * browser dynamic-import, which Electron's renderer can't resolve.
 * Going through `require` (left alone by esbuild for externalised
 * built-ins) is the only reliable path.
 */
function nodeRequire<T = unknown>(name: string): T {
	const g = window as { require?: (id: string) => unknown };
	const w = (typeof window !== "undefined" ? (window as { require?: (id: string) => unknown }) : undefined);
	const req = g.require ?? w?.require;
	if (typeof req !== "function") {
		throw new Error(`Node module '${name}' is not available in this environment`);
	}
	return req(name) as T;
}

function processEnv(): Record<string, string | undefined> {
	const proc = (window as { process?: { env?: Record<string, string | undefined> } }).process;
	return proc?.env ?? {};
}

function homeDir(): string {
	const env = processEnv();
	return env.HOME ?? env.USERPROFILE ?? "";
}

export function expandHome(p: string): string {
	if (!p) return p;
	if (p === "~") return homeDir();
	if (p.startsWith("~/")) {
		const home = homeDir();
		if (home) return `${home}/${p.slice(2)}`;
	}
	return p;
}

function pathSeparator(): string {
	const proc = (window as { process?: { platform?: string } }).process;
	return proc?.platform === "win32" ? ";" : ":";
}

function buildAugmentedPath(extraDirs: string[]): string {
	const env = processEnv();
	const currentPath = env.PATH ?? env.Path ?? "";
	const home = homeDir();
	const userBin = home ? [`${home}/.local/bin`, `${home}/bin`] : [];
	const sep = pathSeparator();
	const seen = new Set<string>();
	const out: string[] = [];
	const push = (p: string) => {
		if (p && !seen.has(p)) {
			seen.add(p);
			out.push(p);
		}
	};
	for (const d of extraDirs) push(d);
	for (const d of userBin) push(d);
	for (const d of COMMON_BIN_DIRS) push(d);
	if (currentPath) {
		for (const part of currentPath.split(sep)) push(part);
	}
	return out.join(sep);
}

interface ChildProcessModule {
	spawn(
		bin: string,
		args: string[],
		options: {
			stdio: [string, string, string];
			env: Record<string, string | undefined>;
			cwd?: string;
		},
	): {
		stdout: { on(event: "data", listener: (chunk: Uint8Array | string) => void): void } | null;
		stderr: { on(event: "data", listener: (chunk: Uint8Array | string) => void): void } | null;
		stdin: { write(data: string): void; end(): void } | null;
		on(event: "error", listener: (err: Error) => void): void;
		on(event: "close", listener: (code: number | null) => void): void;
		kill(): void;
	};
}

interface FsModule {
	accessSync(path: string): void;
}

export async function runChild(
	bin: string,
	args: string[],
	opts: RunChildOptions = {},
): Promise<ChildResult> {
	if (!Platform.isDesktop) {
		throw new Error("Subprocess execution requires Obsidian Desktop");
	}
	const cp = nodeRequire<ChildProcessModule>("child_process");
	const expandedBin = expandHome(bin);
	const env: Record<string, string | undefined> = {
		...processEnv(),
		PATH: buildAugmentedPath(opts.extraPathDirs ?? []),
	};
	return new Promise<ChildResult>((resolve, reject) => {
		const child = cp.spawn(expandedBin, args, {
			stdio: [opts.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
			env,
			cwd: opts.cwd,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (d: Uint8Array | string) => {
			stdout += typeof d === "string" ? d : d.toString();
		});
		child.stderr?.on("data", (d: Uint8Array | string) => {
			stderr += typeof d === "string" ? d : d.toString();
		});
		child.on("error", (err: Error) => {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("ENOENT")) {
				reject(new CliMissingError(bin));
				return;
			}
			reject(err);
		});
		child.on("close", (code: number | null) => resolve({ stdout, stderr, code }));
		opts.signal?.addEventListener(
			"abort",
			() => {
				child.kill();
				reject(new Error("Cancelled"));
			},
			{ once: true },
		);
		if (opts.stdin !== undefined && child.stdin) {
			child.stdin.write(opts.stdin);
			child.stdin.end();
		}
	});
}

/**
 * Locate a binary on PATH (with the same augmentations as `runChild`)
 * and return the absolute path, or null when not found.
 */
export async function whichBin(bin: string): Promise<string | null> {
	if (!Platform.isDesktop) return null;
	const expanded = expandHome(bin);
	// Absolute path: stat it directly.
	if (expanded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(expanded)) {
		try {
			const fs = nodeRequire<FsModule>("fs");
			fs.accessSync(expanded);
			return expanded;
		} catch {
			return null;
		}
	}
	const proc = (window as { process?: { platform?: string } }).process;
	const tool = proc?.platform === "win32" ? "where" : "which";
	try {
		const result = await runChild(tool, [expanded]);
		if (result.code === 0) return result.stdout.trim().split(/\r?\n/)[0] ?? null;
		return null;
	} catch {
		return null;
	}
}

/** Helpers used by callers that need direct Node access (file IO, etc). */
export function loadNodeModule<T = unknown>(name: string): T {
	return nodeRequire<T>(name);
}

