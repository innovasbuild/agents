// Caller de una tool de outreach. La identidad sale siempre de la sesión de
// eve (channels/eve.ts), nunca de un input del modelo.
export interface SessionAuthLike {
	principalType: string;
	principalId: string;
	attributes?: Readonly<Record<string, unknown>>;
}

export interface SessionLike {
	auth: { current: SessionAuthLike | null; initiator: SessionAuthLike | null };
}

export interface Caller {
	tenantId: string;
	userId: string;
	role: string;
	email: string;
}

const text = (value: unknown): string =>
	typeof value === "string" ? value : "";

export function callerFromSession(session: SessionLike): Caller {
	const auth = session.auth.current ?? session.auth.initiator;
	if (auth?.principalType !== "user" || !auth.principalId) {
		throw new Error("la tool requiere un usuario autenticado");
	}
	const tenantId = text(auth.attributes?.tenantId);
	if (!tenantId) throw new Error("la sesión no tiene tenant");
	return {
		tenantId,
		userId: auth.principalId,
		role: text(auth.attributes?.role),
		email: text(auth.attributes?.email),
	};
}
