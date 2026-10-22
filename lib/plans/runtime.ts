// Las dependencias reales del vencimiento del plan Free, armadas desde el
// entorno. Sin imports de Next: lo usa un schedule de eve.
import { createAdminClient } from "../supabase/admin";
import { createTrialStore, type TrialStore } from "./trial";

export function trialDeps(): { store: TrialStore; now: () => Date } {
	return {
		store: createTrialStore(createAdminClient()),
		now: () => new Date(),
	};
}
