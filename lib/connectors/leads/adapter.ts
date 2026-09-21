// Capacidad leads escrita contra la interfaz, no contra el proveedor
// (arquitectura D2, spec etapa 13 §5.1). Apollo es la primera implementación.

export interface TargetCriteria {
	/** Rangos de Apollo, tal cual: "50,200". */
	employeeRanges: string[];
	locations: string[];
	keywords: string[];
	titles: string[];
}

export interface LeadOrganization {
	externalId: string;
	name: string;
	/** Sin dominio no hay research ni ancla: el nodo la descarta. */
	domain: string | null;
	linkedinUrl: string | null;
	employees: number | null;
	industry: string | null;
	location: string | null;
	foundedYear: number | null;
}

export interface LeadPerson {
	externalId: string;
	name: string;
	title: string | null;
	linkedinSlug: string | null;
	organizationExternalId: string | null;
}

export interface LeadsAdapter {
	searchOrganizations(
		criteria: TargetCriteria,
		page: number,
	): Promise<{
		organizations: LeadOrganization[];
		hasMore: boolean;
		creditsUsed: number;
	}>;
	searchPeople(
		criteria: TargetCriteria,
		organizationExternalIds: string[],
		page: number,
	): Promise<{ people: LeadPerson[]; hasMore: boolean; creditsUsed: number }>;
	/** Revelar un email cuesta un crédito por cabeza: por eso se llama después de calificar. */
	revealEmail(
		personExternalId: string,
	): Promise<{ email: string | null; creditsUsed: number }>;
}
