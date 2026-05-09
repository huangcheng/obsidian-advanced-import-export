import { bearFactory } from "./bear/bear-provider";
import { flomoFactory } from "./flomo/flomo-provider";
import { ProviderRegistry } from "./registry";
import { wpsFactory } from "./wps/wps-provider";
import { youdaoFactory } from "./youdao/youdao-provider";

/**
 * Register every built-in provider factory with the supplied registry.
 * Called once during plugin onload.
 */
export function registerAllFactories(registry: ProviderRegistry): void {
	registry.registerFactory(bearFactory);
	registry.registerFactory(wpsFactory);
	registry.registerFactory(youdaoFactory);
	registry.registerFactory(flomoFactory);
}
