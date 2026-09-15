// Clave de identidad determinística del canon (spec 03 D4, §5.1):
// em:<email> → li:<slug> → h:<sha1(nombre|empresa)>.
import { createHash } from "node:crypto";
import { normalizeText } from "./text";

export class ContactKeyError extends Error {
	constructor() {
		super(
			"no alcanza para armar el contact_key: hace falta email, LinkedIn, o nombre y empresa",
		);
		this.name = "ContactKeyError";
	}
}

export interface ContactKeyInput {
	email?: string | null;
	linkedinUrl?: string | null;
	name?: string | null;
	company?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
	const email = (raw ?? "").trim().toLowerCase();
	return EMAIL.test(email) ? email : null;
}

/** Porta normalizar_id de pertenencia.py: URL de perfil o slug suelto. */
export function linkedinSlug(raw: string | null | undefined): string | null {
	const value = (raw ?? "").trim().toLowerCase();
	if (!value) return null;
	const fromUrl = value.match(/linkedin\.com\/in\/([^/?#\s]+)/);
	if (fromUrl) return fromUrl[1];
	if (/[/@\s]/.test(value)) return null;
	// Un valor suelto (no extraído de una URL de perfil) es más propenso a ser
	// basura ("-", "x", un número) que un slug real: exigimos largo mínimo y
	// al menos una letra.
	if (value.length < 3 || !/[a-z]/.test(value)) return null;
	return value;
}

function normalizePart(text: string | null | undefined): string {
	return normalizeText(text ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

export function contactKey(input: ContactKeyInput): string {
	const email = normalizeEmail(input.email);
	if (email) return `em:${email}`;
	const slug = linkedinSlug(input.linkedinUrl);
	if (slug) return `li:${slug}`;
	const name = normalizePart(input.name);
	const company = normalizePart(input.company);
	if (name && company) {
		return `h:${createHash("sha1").update(`${name}|${company}`).digest("hex")}`;
	}
	throw new ContactKeyError();
}
