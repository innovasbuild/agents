// Import con extensión .ts: este archivo lo ejecuta Node directo (type stripping).
import {
	type Capability,
	isProviderKey,
	PROVIDERS,
	type ProviderKey,
} from "../lib/connectors/providers.ts";

export interface BindArgs {
	tenant: string;
	capability: Capability;
	provider: ProviderKey;
	connector: string | null;
	configPath: string | null;
}

function flag(argv: string[], name: string): string | null {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return null;
	const value = argv[index + 1];
	return value && !value.startsWith("--") ? value : null;
}

export function parseBindArgs(argv: string[]): BindArgs {
	const tenant = flag(argv, "tenant");
	if (!tenant) throw new Error("falta --tenant <slug>");

	const provider = flag(argv, "provider") ?? "";
	if (!isProviderKey(provider)) {
		throw new Error(
			`proveedor desconocido: "${provider}". Válidos: ${Object.keys(PROVIDERS).join(", ")}`,
		);
	}
	const info = PROVIDERS[provider];

	const capability = flag(argv, "capability");
	if (capability !== info.capability) {
		throw new Error(
			`la capacidad de ${provider} es ${info.capability}, no "${capability ?? ""}"`,
		);
	}

	const connector = flag(argv, "connector");
	if (info.authKind === "connect_api_key" && !connector) {
		throw new Error(
			`${provider} usa API key: falta --connector <uid del conector de Connect>`,
		);
	}
	if (info.authKind === "connect_oauth" && connector) {
		throw new Error(
			`${provider} usa el conector OAuth de plataforma: no se pasa --connector`,
		);
	}
	if (info.authKind === "none" && connector) {
		throw new Error(
			`${provider} es un proveedor sin llave: no se pasa --connector`,
		);
	}

	const rawConfig = flag(argv, "config");
	const configPath = rawConfig ? rawConfig.replace(/^@/, "") : null;
	const needsConfig = provider === "wiki" || provider === "mcp";
	if (needsConfig && !configPath) {
		throw new Error(
			`${provider} necesita --config <ruta a tenants/<slug>/brain*.json>`,
		);
	}
	if (!needsConfig && configPath) {
		throw new Error(`${provider} no acepta --config`);
	}

	return {
		tenant,
		capability: info.capability,
		provider,
		connector,
		configPath,
	};
}
