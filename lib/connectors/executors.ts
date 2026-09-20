import { createAdminClient } from "../supabase/admin";

/**
 * Estampa la autorización de Gmail del ejecutor: envío Y lectura, en la misma
 * escritura.
 *
 * Las dos columnas se ganan con el mismo grant. `GMAIL_SCOPES`
 * (`lib/gmail/send.ts`) es `[gmail.send, gmail.readonly]` y es el ÚNICO
 * conjunto que se pide bajo el authKey "gmail" — Connect matchea el grant por
 * el conjunto exacto de scopes, así que no hay forma de que exista un grant de
 * "gmail" con uno solo de los dos.
 *
 * Verificado contra `node_modules/eve/dist/src/protocol/message.d.ts`
 * (`AuthorizationCompletedStreamEvent`) y
 * `node_modules/eve/dist/src/connections/errors.d.ts`
 * (`ConnectionAuthorizationChallenge`): el evento `authorization.completed` NO
 * expone los scopes concedidos — trae `name`, `outcome`, `reason`, ids del
 * intento y el challenge (url, userCode, expiresAt, instructions,
 * displayName), nada más. O sea: no se puede estampar la lectura "solo si la
 * lectura está" porque el dato no llega. Se estampan las dos, que es lo que
 * el único conjunto pedido bajo ese authKey garantiza.
 *
 * Ojo con los ejecutores que autorizaron ANTES de que `gmail.readonly` entrara
 * en `GMAIL_SCOPES`: su grant real no tiene lectura, y si reautorizan van a
 * quedar con la columna estampada igual. El barrido les va a fallar al leer
 * Gmail, y eso cae en `ejecutoresFallidos` — visible, que es mejor que el
 * silencio de no barrer a nadie. No se adivina quién tiene qué: no hay
 * migración que estampe filas viejas.
 */
export async function markGmailAuthorized(
	tenantId: string,
	userId: string,
): Promise<void> {
	const now = new Date().toISOString();
	const { error } = await createAdminClient().from("executors").upsert(
		{
			tenant_id: tenantId,
			user_id: userId,
			gmail_authorized_at: now,
			gmail_read_authorized_at: now,
		},
		{ onConflict: "tenant_id,user_id" },
	);
	if (error)
		throw new Error(`No pude registrar la casilla de Gmail: ${error.message}`);
}
