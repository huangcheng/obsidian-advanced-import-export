import { en } from "./locales/en";
import { zh } from "./locales/zh";

// Type representing the nested structure with string values
type TranslationShape = {
	[key: string]: string | TranslationShape;
};

// Recursive type to generate all dot-notation paths from nested object
type NestedPaths<T, Prefix extends string = ""> = {
	[K in keyof T & string]: T[K] extends Record<string, unknown>
		? NestedPaths<T[K], `${Prefix}${K}.`>
		: `${Prefix}${K}`;
}[keyof T & string];

export type TranslationKey = NestedPaths<typeof en>;

const locales: Record<string, TranslationShape> = { en, zh };
let currentLocale: TranslationShape = en;

function getValue(obj: unknown, path: string): string | undefined {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return typeof current === "string" ? current : undefined;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
	let value = getValue(currentLocale, key) ?? getValue(en, key);
	if (value === undefined) {
		console.warn(`[i18n] Missing translation key: ${key}`);
		return key;
	}
	if (params) {
		return value.replace(/\{\{(\w+)\}\}/g, (_, paramKey: string) => {
			const paramValue = params[paramKey];
			return paramValue !== undefined ? String(paramValue) : `{{${paramKey}}}`;
		});
	}
	return value;
}

export function initializeI18n(locale?: string): void {
	const normalized = (locale ?? "en").toLowerCase();
	const lang = normalized.startsWith("zh") ? "zh" : normalized in locales ? normalized : "en";
	currentLocale = locales[lang] ?? en;
}
