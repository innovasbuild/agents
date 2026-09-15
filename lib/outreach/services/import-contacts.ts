// F1 con CSV (spec 03 §6.4): contact_key, G1 contra el CRM y claim por persona.
// El juicio de ICP lo hace el modelo con el canon; acá solo lo mecánico.
import type { CrmAdapter } from "../../connectors/crm/adapter";
import { contactKey, linkedinSlug } from "../contact-key";
import { parseContactsCsv } from "../csv";
import { type OutreachEventInsert, outreachEvent } from "../events";
import { claimStatus, crmMatch } from "../guards";
import { isRefusal, type Refusal } from "../result";
import type { Caller } from "../session";
import type { OutreachStore } from "../store";
import { resolveExecutor } from "./executor";

export type ImportVerdict =
	| "nuevo"
	| "ya_existia"
	| "claim_ajeno"
	| "sin_email"
	| "invalida";

export interface ImportRowResult {
	line: number;
	name: string | null;
	email: string | null;
	contactKey: string | null;
	verdict: ImportVerdict;
	message: string;
}

export interface ImportDeps {
	store: OutreachStore;
	crm: CrmAdapter | null;
	now: () => Date;
}

export async function importContacts(
	input: { csv: string; caller: Caller },
	deps: ImportDeps,
): Promise<
	| Refusal
	| {
			ok: true;
			rows: ImportRowResult[];
			errors: Array<{ line: number; reason: string }>;
	  }
> {
	const { caller } = input;
	const resolved = await resolveExecutor(deps.store, caller, deps.crm);
	if (isRefusal(resolved)) return resolved;
	const { executor, tenant } = resolved;

	const parsed = parseContactsCsv(input.csv);
	const withEmail = parsed.rows.filter((row) => row.email);
	const keys = withEmail.map((row) => contactKey({ email: row.email }));
	const existing = new Map(
		(await deps.store.findContactsByKeys(caller.tenantId, keys)).map((c) => [
			c.contactKey,
			c,
		]),
	);

	const rows: ImportRowResult[] = [];
	const events: OutreachEventInsert[] = [];
	const seen = new Set<string>();
	const now = deps.now();

	for (const row of parsed.rows) {
		const base = { line: row.line, name: row.name, email: row.email };
		if (!row.email) {
			rows.push({
				...base,
				contactKey: null,
				verdict: "sin_email",
				message: "sin email válido: en la v1 solo se escribe por email",
			});
			continue;
		}
		const key = contactKey({ email: row.email });
		if (seen.has(key)) {
			rows.push({
				...base,
				contactKey: key,
				verdict: "invalida",
				message: "fila repetida en el CSV",
			});
			continue;
		}
		seen.add(key);
		if (row.segment && !tenant.values.segmento.includes(row.segment)) {
			rows.push({
				...base,
				contactKey: key,
				verdict: "invalida",
				message: `segmento desconocido: ${row.segment}`,
			});
			continue;
		}
		if (row.vector && !tenant.values.vector.includes(row.vector)) {
			rows.push({
				...base,
				contactKey: key,
				verdict: "invalida",
				message: `vector desconocido: ${row.vector}`,
			});
			continue;
		}

		const known = existing.get(key);
		if (known) {
			const claim = claimStatus({
				ownerUserId: known.ownerUserId,
				executorUserId: caller.userId,
				executorCrmOwnerId: executor.crmOwnerId,
				crmAuthorship: null,
				now,
			});
			if (claim === "ajeno") {
				rows.push({
					...base,
					contactKey: key,
					verdict: "claim_ajeno",
					message: "esta persona ya la trabaja otro ejecutor",
				});
				events.push(
					outreachEvent({
						tenant_id: caller.tenantId,
						actor_user_id: caller.userId,
						contact_key: key,
						type: "claim_ajeno",
						summary: "carga de CSV",
						payload: { origen: "import_contacts" },
					}),
				);
			} else {
				rows.push({
					...base,
					contactKey: key,
					verdict: "ya_existia",
					message: "ya estaba cargado: no se cambió nada",
				});
			}
			continue;
		}

		let crmId: string | null = null;
		if (deps.crm) {
			const match = crmMatch(
				await deps.crm.findContacts({
					contactKey: key,
					email: row.email,
					linkedinSlug: linkedinSlug(row.linkedinUrl),
				}),
				{
					contactKey: key,
					email: row.email,
					linkedinSlug: linkedinSlug(row.linkedinUrl),
				},
			);
			if (match) {
				const authorship = await deps.crm.lastAuthorship(match.id);
				const claim = claimStatus({
					ownerUserId: null,
					executorUserId: caller.userId,
					executorCrmOwnerId: executor.crmOwnerId,
					crmAuthorship: authorship,
					now,
				});
				if (claim === "ajeno") {
					rows.push({
						...base,
						contactKey: key,
						verdict: "claim_ajeno",
						message:
							"en el CRM la última conversación con esta persona es de otro owner, hace menos de 90 días",
					});
					events.push(
						outreachEvent({
							tenant_id: caller.tenantId,
							actor_user_id: caller.userId,
							contact_key: key,
							type: "claim_ajeno",
							summary: "autoría en el CRM",
							payload: { origen: "import_contacts", crm_id: match.id },
						}),
					);
					continue;
				}
				crmId = match.id;
			}
		}

		await deps.store.insertContact({
			tenantId: caller.tenantId,
			contactKey: key,
			accountId: null,
			name: row.name,
			company: row.company,
			email: row.email,
			linkedinSlug: linkedinSlug(row.linkedinUrl),
			crmId,
			segment: row.segment,
			vector: row.vector,
			source: "csv",
		});
		rows.push({
			...base,
			contactKey: key,
			verdict: "nuevo",
			message: "cargado",
		});
		events.push(
			outreachEvent({
				tenant_id: caller.tenantId,
				actor_user_id: caller.userId,
				contact_key: key,
				type: "contacto_importado",
				summary: row.company ?? row.email,
				payload: { linea: row.line, crm_id: crmId },
			}),
		);
	}

	await deps.store.insertEvents(events);
	return { ok: true, rows, errors: parsed.errors };
}
