// Apollo por REST (spec etapa 13 §5.1). Una llave por llamada; el fallback
// entre llaves lo agrega la Task 3 envolviendo esta misma función.
import { linkedinSlug } from "../../outreach/contact-key";
import type {
	LeadOrganization,
	LeadPerson,
	LeadsAdapter,
	TargetCriteria,
} from "./adapter";
import { ApolloOutOfCreditsError, ApolloUnauthorizedError } from "./apollo";

const API = "https://api.apollo.io/api/v1";
const TIMEOUT_MS = 20_000;
export const PER_PAGE = 100;

/** Apollo devuelve este literal cuando no puede revelar el email. */
const LOCKED_EMAIL = "email_not_unlocked";

type Row = Record<string, unknown>;

const str = (row: Row, key: string): string | null => {
	const value = row[key];
	return typeof value === "string" && value.trim() !== "" ? value : null;
};

const num = (row: Row, key: string): number | null => {
	const value = row[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
};

function toOrganization(row: Row): LeadOrganization {
	const city = str(row, "city");
	const country = str(row, "country");
	return {
		externalId: String(row.id ?? ""),
		name: str(row, "name") ?? "",
		domain: str(row, "primary_domain"),
		linkedinUrl: str(row, "linkedin_url"),
		employees: num(row, "estimated_num_employees"),
		industry: str(row, "industry"),
		location: [city, country].filter(Boolean).join(", ") || null,
		foundedYear: num(row, "founded_year"),
	};
}

function toPerson(row: Row): LeadPerson {
	return {
		externalId: String(row.id ?? ""),
		name: str(row, "name") ?? "",
		title: str(row, "title"),
		linkedinSlug: linkedinSlug(str(row, "linkedin_url")),
		organizationExternalId: str(row, "organization_id"),
	};
}

/** Un solo adapter contra una sola llave. */
export function createApolloAdapterForKey(
	key: string,
	fetchImpl: typeof fetch = fetch,
): LeadsAdapter {
	async function call(path: string, body: unknown): Promise<Row> {
		const response = await fetchImpl(`${API}${path}`, {
			method: "POST",
			headers: { "x-api-key": key, "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (response.status === 401 || response.status === 403) {
			throw new ApolloUnauthorizedError();
		}
		if (!response.ok) {
			const text = (await response.text()).slice(0, 300);
			// Heurística de S4: Apollo no documenta un código propio para el
			// agotamiento. Se ajusta con el primer caso real en producción.
			if (/credit|insufficient|quota/i.test(text)) {
				throw new ApolloOutOfCreditsError();
			}
			throw new Error(`Apollo respondió ${response.status} en ${path}: ${text}`);
		}
		return (await response.json()) as Row;
	}

	const hasMore = (json: Row): boolean => {
		const pagination = (json.pagination ?? {}) as Row;
		const page = num(pagination, "page") ?? 1;
		const total = num(pagination, "total_pages") ?? 1;
		return page < total;
	};

	return {
		async searchOrganizations(criteria: TargetCriteria, page: number) {
			const json = await call("/mixed_companies/search", {
				organization_num_employees_ranges: criteria.employeeRanges,
				organization_locations: criteria.locations,
				q_organization_keyword_tags: criteria.keywords,
				page,
				per_page: PER_PAGE,
			});
			// mixed_companies puede devolver las guardadas en la cuenta en otra clave.
			const rows = [
				...(((json.organizations as Row[]) ?? []) as Row[]),
				...(((json.accounts as Row[]) ?? []) as Row[]),
			];
			return {
				organizations: rows.map(toOrganization),
				hasMore: hasMore(json),
				creditsUsed: 1,
			};
		},

		async searchPeople(
			criteria: TargetCriteria,
			organizationExternalIds: string[],
			page: number,
		) {
			const json = await call("/mixed_people/search", {
				organization_ids: organizationExternalIds,
				person_titles: criteria.titles,
				page,
				per_page: PER_PAGE,
			});
			const rows = [
				...(((json.people as Row[]) ?? []) as Row[]),
				...(((json.contacts as Row[]) ?? []) as Row[]),
			];
			return {
				people: rows.map(toPerson),
				hasMore: hasMore(json),
				creditsUsed: 1,
			};
		},

		async revealEmail(personExternalId: string) {
			const json = await call("/people/match", {
				id: personExternalId,
				reveal_personal_emails: false,
			});
			const person = (json.person ?? {}) as Row;
			const email = str(person, "email");
			return {
				email: email && !email.includes(LOCKED_EMAIL) ? email : null,
				creditsUsed: 1,
			};
		},
	};
}

/** Firma pública; la Task 3 le agrega el fallback entre llaves. */
export function createApolloAdapter(
	keys: string[],
	fetchImpl: typeof fetch = fetch,
): LeadsAdapter {
	if (keys.length === 0) throw new Error("createApolloAdapter sin llaves");
	return createApolloAdapterForKey(keys[0], fetchImpl);
}
