// Capacidad crm escrita contra la interfaz, no contra el proveedor
// (arquitectura D2, spec 03 §9). HubSpot es la primera implementación.
export interface CrmContactMatch {
	id: string;
	contactKey: string | null;
	email: string | null;
	linkedinSlugs: string[];
	ownerId: string | null;
}

export interface CrmAdapter {
	findContacts(query: {
		contactKey: string;
		email: string | null;
		linkedinSlug: string | null;
	}): Promise<CrmContactMatch[]>;
	lastAuthorship(crmId: string): Promise<{ ownerId: string; at: Date } | null>;
	upsertContact(input: {
		crmId: string | null;
		email: string | null;
		name: string | null;
		company: string | null;
		properties: Record<string, string>;
	}): Promise<string>;
	addNote(
		crmId: string,
		note: { body: string; at: Date; ownerId: string | null },
	): Promise<void>;
	completeOpenTasks(crmId: string): Promise<void>;
	createTask(
		crmId: string,
		task: { title: string; dueAt: Date; ownerId: string | null },
	): Promise<void>;
}
