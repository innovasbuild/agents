// El ICP se lee una vez por pasada, no una vez por contacto (spec 21.3 §3.4).
// La clave lleva la corrida: una pasada nueva lo vuelve a leer. Solo se
// guarda el resultado ok: un fallo se reintenta en el ítem siguiente.
import type { CanonLoad } from "./canon";
import type { IcpLevels } from "./canon-blocks";

export function createIcpCache(
	read: (tenantId: string) => Promise<CanonLoad<IcpLevels>>,
) {
	const cache = new Map<string, Promise<CanonLoad<IcpLevels>>>();
	return (tenantId: string, runId: string): Promise<CanonLoad<IcpLevels>> => {
		const key = `${tenantId}:${runId}`;
		const hit = cache.get(key);
		if (hit) return hit;
		const pending = read(tenantId);
		if (cache.size >= 50) cache.clear();
		cache.set(key, pending);
		const forget = () => {
			if (cache.get(key) === pending) cache.delete(key);
		};
		pending.then((loaded) => {
			if (!loaded.ok) forget();
		}, forget);
		return pending;
	};
}
