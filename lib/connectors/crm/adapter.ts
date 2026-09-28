// Capacidad crm escrita contra la interfaz, no contra el proveedor
// (arquitectura D2, spec 03 §9). HubSpot es la primera implementación.
export interface CrmContactMatch {
	id: string;
	contactKey: string | null;
	email: string | null;
	linkedinSlugs: string[];
	ownerId: string | null;
}

export interface CrmContactCheck {
	id: string;
	/** true = existe en HubSpot; false = borrado, confirmado por HubSpot
	 * (category OBJECT_NOT_FOUND). Un id que no aparece en el array de salida
	 * de batchCheckContacts no es ninguna de las dos cosas: su estado no se
	 * pudo confirmar en esta corrida. */
	found: boolean;
	ownerId: string | null;
}

export interface CrmActivityNote {
	id: string;
	body: string;
	at: Date;
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
	/** Deals del contacto que no están en closedwon ni closedlost (task 6). */
	listOpenDeals(contactCrmId: string): Promise<{ id: string; stage: string }[]>;
	/** Nace en pipeline `default`, stage `1404975950` (Contactado): los IDs
	 * salen del CLAUDE.md del repo, no se inventan. */
	createDeal(input: {
		contactCrmId: string;
		companyCrmId: string | null;
		name: string;
		description: string;
		ownerId: string;
	}): Promise<{ id: string }>;
	/** Existencia + owner de hasta 100 contactos por llamada. Los ids que no se
	 * puedan confirmar como existentes ni como borrados quedan fuera del
	 * resultado (nunca se asume ninguna de las dos cosas por default). */
	batchCheckContacts(crmIds: string[]): Promise<CrmContactCheck[]>;
	/** Notas del contacto más nuevas que `sinceIso` (todas si es null). */
	listNotesSince(crmId: string, sinceIso: string | null): Promise<CrmActivityNote[]>;
}
