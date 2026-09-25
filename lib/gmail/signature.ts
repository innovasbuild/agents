// Firma de mail para el envío de outreach. Sin datos de ejecutor no hay firma:
// `compose` devuelve el texto plano tal cual y `html: null`, así que
// buildRawMessage (mime.ts) sigue mandando solo text/plain como hasta ahora.
export interface Signer {
	displayName: string | null;
	title: string | null;
	linkedinUrl: string | null;
}

export interface Company {
	name: string;
	url: string;
}

export interface ComposedMail {
	text: string;
	html: string | null;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Gmail no ofrece un editor rico acá: el cuerpo que redacta y aprueba el
// ejecutor es texto plano con líneas en blanco entre párrafos.
function bodyToHtml(body: string): string {
	return body
		.split(/\n{2,}/)
		.map(
			(paragraph) =>
				`<p style="margin:0 0 1em;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
		)
		.join("\n");
}

function signatureText(signer: Signer, company: Company | null): string {
	const lines = [signer.displayName as string];
	if (signer.title) lines.push(signer.title);
	if (company) lines.push(`${company.name} — ${company.url}`);
	if (signer.linkedinUrl) lines.push(`LinkedIn: ${signer.linkedinUrl}`);
	return lines.join("\n");
}

// Badge "in" de texto, sin imagen: un logo hosteado se cae en varios
// clientes de mail (Outlook bloquea remotas por default) y una firma de
// prospección no puede depender de que carguen.
function signatureHtml(signer: Signer, company: Company | null): string {
	const name = `<div style="font-weight:600;color:#0f172a;">${escapeHtml(signer.displayName as string)}</div>`;
	const title = signer.title
		? `<div style="color:#64748b;">${escapeHtml(signer.title)}</div>`
		: "";
	const companyLink = company
		? `<a href="${escapeHtml(company.url)}" style="color:#1D4ED8;text-decoration:none;font-weight:600;">${escapeHtml(company.name)}</a>`
		: "";
	const linkedin = signer.linkedinUrl
		? `<a href="${escapeHtml(signer.linkedinUrl)}" style="display:inline-block;margin-left:8px;width:20px;height:20px;line-height:20px;text-align:center;background:#0A66C2;color:#ffffff;border-radius:4px;font-size:11px;font-weight:700;text-decoration:none;vertical-align:middle;">in</a>`
		: "";
	const links =
		companyLink || linkedin
			? `<div style="margin-top:6px;">${companyLink}${linkedin}</div>`
			: "";
	return [
		'<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#334155;">',
		name,
		title,
		links,
		"</div>",
	]
		.filter(Boolean)
		.join("\n");
}

/** El bloque de firma en texto, tal cual queda al pie del mail, o null si el
 * ejecutor todavía no tiene `displayName`. Lo usa composeMail al enviar y la
 * previsualización del chat, para que el ejecutor apruebe lo que se manda. */
export function signatureBlock(
	signer: Signer,
	company: Company | null,
): string | null {
	if (!signer.displayName) return null;
	return `--\n${signatureText(signer, company)}`;
}

/** Cuerpo aprobado más el bloque de firma: el texto que lee el destinatario. */
export function mailText(body: string, block: string | null): string {
	return block ? `${body}\n\n${block}` : body;
}

/** Arma el mail final a partir del cuerpo aprobado: sin `displayName` no hay
 * firma que mostrar (ejecutor sin cargar todavía), y se manda como siempre. */
export function composeMail(
	body: string,
	signer: Signer,
	company: Company | null,
): ComposedMail {
	const block = signatureBlock(signer, company);
	if (!block) return { text: body, html: null };
	return {
		text: mailText(body, block),
		html: `${bodyToHtml(body)}\n${signatureHtml(signer, company)}`,
	};
}
