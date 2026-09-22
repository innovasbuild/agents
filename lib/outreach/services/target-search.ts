// Nodo leads/search-targets (spec etapa 13 §5.2): una página de empresas y la
// gente de esas empresas. No revela emails: eso se paga por cabeza y se hace
// después de calificar.
import type { CrmAdapter } from "../../connectors/crm/adapter";
import type { LeadsAdapter } from "../../connectors/leads/adapter";
import { contactKey, ContactKeyError } from "../contact-key";
import { normalizeDomain } from "../domain";
import { parseTargetCriteria } from "../focus";
import { claimStatus } from "../guards";
import { type Refusal, refuse } from "../result";
import type { FocusRow, OutreachStore } from "../store";

export interface TargetSearchDeps {
	store: OutreachStore;
	leads: LeadsAdapter;
	crm: CrmAdapter | null;
	now: () => Date;
}

export type SearchPageResult =
	| Refusal
	| {
			ok: true;
			contactIds: string[];
			accounts: number;
			discarded: Record<string, number>;
			hasMore: boolean;
			creditsUsed: number;
	  };

export async function searchTargetsPage(
	input: { focus: FocusRow; page: number },
	deps: TargetSearchDeps,
): Promise<SearchPageResult> {
	const { focus } = input;
	if (focus.status !== "activo") {
		return refuse("foco_inactivo", `el foco ${focus.name} ya no está activo`);
	}

	let criteria: ReturnType<typeof parseTargetCriteria>;
	try {
		criteria = parseTargetCriteria(focus.criteria);
	} catch (error) {
		return refuse(
			"criterio_invalido",
			`el foco ${focus.name} tiene filtros inválidos: ${error instanceof Error ? error.message : "sin detalle"}`,
		);
	}

	const discarded: Record<string, number> = {};
	const count = (reason: string) => {
		discarded[reason] = (discarded[reason] ?? 0) + 1;
	};

	let creditsUsed = 0;
	const orgs = await deps.leads.searchOrganizations(criteria, input.page);
	creditsUsed += orgs.creditsUsed;

	// Cupo de empresas que queda en el foco.
	const accountsLeft = Math.max(focus.maxAccounts - focus.accountsFound, 0);
	const usable: Array<{ accountId: string; externalId: string; name: string }> = [];

	for (const org of orgs.organizations.slice(0, accountsLeft)) {
		const domain = normalizeDomain(org.domain ?? "");
		if (!domain) {
			count("sin_dominio");
			continue;
		}
		const account = await deps.store.upsertDiscoveredAccount({
			tenantId: focus.tenantId,
			domain,
			name: org.name,
			firmographics: {
				employees: org.employees,
				industry: org.industry,
				location: org.location,
				foundedYear: org.foundedYear,
				linkedinUrl: org.linkedinUrl,
			},
			externalIds: { apollo: org.externalId },
		});
		usable.push({ accountId: account.id, externalId: org.externalId, name: org.name });
	}

	if (usable.length === 0) {
		return {
			ok: true,
			contactIds: [],
			accounts: 0,
			discarded,
			hasMore: orgs.hasMore,
			creditsUsed,
		};
	}

	const people = await deps.leads.searchPeople(
		criteria,
		usable.map((account) => account.externalId),
		1,
	);
	creditsUsed += people.creditsUsed;

	const byExternalId = new Map(usable.map((a) => [a.externalId, a]));
	const contactsLeft = Math.max(focus.maxContacts - focus.contactsFound, 0);
	const contactIds: string[] = [];

	for (const person of people.people) {
		if (contactIds.length >= contactsLeft) break;
		const account = person.organizationExternalId
			? byExternalId.get(person.organizationExternalId)
			: undefined;
		const company = account?.name ?? "";

		let key: string;
		try {
			key = contactKey({
				linkedinUrl: person.linkedinSlug,
				name: person.name,
				company,
			});
		} catch (error) {
			count(error instanceof ContactKeyError ? "sin_clave" : "invalida");
			continue;
		}

		// El claim manda: una persona la trabaja un solo ejecutor. Este nodo no
		// consulta al CRM (no hay autoría reciente que revisar acá), así que
		// solo pesa el dueño ya guardado en la base.
		const [existing] = await deps.store.findContactsByKeys(focus.tenantId, [key]);
		const claim = claimStatus({
			ownerUserId: existing?.ownerUserId ?? null,
			executorUserId: focus.createdBy,
			executorCrmOwnerId: null,
			crmAuthorship: null,
			now: deps.now(),
		});
		if (claim === "ajeno") {
			count("claim_ajeno");
			continue;
		}
		if (existing) {
			count("ya_existia");
			continue;
		}

		const inserted = await deps.store.insertDiscoveredContact({
			tenantId: focus.tenantId,
			contactKey: key,
			accountId: account?.accountId ?? null,
			ownerUserId: focus.createdBy,
			searchFocusId: focus.id,
			name: person.name,
			company,
			title: person.title,
			linkedinSlug: person.linkedinSlug,
			segment: focus.segment,
			vector: focus.vector,
			hook: focus.hook,
			idioma: focus.idioma,
			externalIds: { apollo: person.externalId },
		});
		if (inserted === "duplicado") {
			count("ya_existia");
			continue;
		}
		contactIds.push(inserted.id);
	}

	return {
		ok: true,
		contactIds,
		accounts: usable.length,
		discarded,
		hasMore: orgs.hasMore,
		creditsUsed,
	};
}
