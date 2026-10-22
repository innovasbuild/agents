// Lugares del plan gratis en el paso de equipo. Una invitación pendiente
// reserva lugar (igual que canInvite en lib/plans/limits.ts).

export const FREE_SEATS = 3;
const MAX_ROWS = 2;

export function seatsUsed(p: {
	users: number;
	pendingInvitations: number;
	filledRows: number;
}): number {
	return p.users + p.pendingInvitations + p.filledRows;
}

/** Filas de correo que se muestran: solo mientras queden lugares. */
export function maxInviteRows(p: {
	users: number;
	pendingInvitations: number;
}): number {
	return Math.min(
		MAX_ROWS,
		Math.max(0, FREE_SEATS - p.users - p.pendingInvitations),
	);
}
