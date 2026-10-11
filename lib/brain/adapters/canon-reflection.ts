// Engancha el reflejo del marco al guardado de páginas (spec 21.3 §3.5, O4).
// El brain no conoce al outreach: recibe la función por parámetro. Un reflejo
// que falla se registra y el guardado sigue (O5).
import type { BrainProvider } from "../core/types";

const MARCO_TAG = "canon:hooks";

export function withCanonReflection(
	provider: BrainProvider,
	onMarcoChange: () => Promise<unknown>,
): BrainProvider {
	return {
		search: (input) => provider.search(input),
		read: (slug, options) => provider.read(slug, options),
		list: () => provider.list(),
		history: (slug) => provider.history(slug),
		async upsert(write, author) {
			let touchesMarco = write.tags.includes(MARCO_TAG);
			if (!touchesMarco) {
				// Si le quitaron el tag, sus hooks ya no valen: hay que reflejar.
				try {
					const previous = await provider.read(write.slug, {
						suggestions: false,
					});
					touchesMarco = previous.tags.includes(MARCO_TAG);
				} catch {
					touchesMarco = false;
				}
			}
			const result = await provider.upsert(write, author);
			if (touchesMarco) {
				try {
					await onMarcoChange();
				} catch (error) {
					console.error("brain: el reflejo del marco falló:", error);
				}
			}
			return result;
		},
	};
}
