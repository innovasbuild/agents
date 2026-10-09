import { describe, expect, it, vi } from "vitest";
import {
	emailFromAccessToken,
	landingPathFor,
	parseSessionFragment,
	resolveConfirmation,
} from "@/lib/auth/confirm";

const ORIGIN = "https://app.test";
const FRAGMENT = "#access_token=AAA&refresh_token=RRR&type=invite";

function deps(
	overrides: {
		fragment?: string;
		opens?: boolean;
		acceptThrows?: boolean;
		next?: string | null;
		gate?: { ok: true } | { ok: false; landing: string };
		gateThrows?: boolean;
		closeThrows?: boolean;
	} = {},
) {
	const calls: string[] = [];
	return {
		calls,
		input: {
			fragment: overrides.fragment ?? FRAGMENT,
			clearFragment: () => {
				calls.push("clear");
			},
			openSession: async () => {
				calls.push("open");
				return overrides.opens ?? true;
			},
			acceptInvitations: async () => {
				calls.push("accept");
				if (overrides.acceptThrows) throw new Error("boom");
			},
			gate: async () => {
				calls.push("gate");
				if (overrides.gateThrows) throw new Error("boom");
				return overrides.gate ?? { ok: true as const };
			},
			closeSession: async () => {
				calls.push("close");
				if (overrides.closeThrows) throw new Error("boom");
			},
			next: overrides.next === undefined ? "/acme/chat" : overrides.next,
			origin: ORIGIN,
		},
	};
}

describe("resolveConfirmation", () => {
	it("abre la sesión, acepta las invitaciones y manda al destino", async () => {
		const { input, calls } = deps();

		expect(await resolveConfirmation(input)).toBe("/acme/chat");
		expect(calls).toEqual(["clear", "open", "accept", "gate"]);
	});

	it("saca el fragmento de la URL ANTES de cualquier espera de red", async () => {
		const { input, calls } = deps();

		await resolveConfirmation(input);

		expect(calls[0]).toBe("clear");
	});

	it("le pasa los tokens del fragmento a openSession", async () => {
		const open = vi.fn(async () => true);
		const { input } = deps();

		await resolveConfirmation({ ...input, openSession: open });

		expect(open).toHaveBeenCalledWith({
			accessToken: "AAA",
			refreshToken: "RRR",
		});
	});

	it("un fragmento de error (link vencido) no abre sesión ni acepta nada", async () => {
		const { input, calls } = deps({
			fragment: "#error=access_denied&error_code=otp_expired",
		});

		expect(await resolveConfirmation(input)).toBe("/login?error=auth_failed");
		expect(calls).toEqual(["clear"]);
	});

	it("sin fragmento no acepta nada, aunque el navegador ya tuviera sesión", async () => {
		const { input, calls } = deps({ fragment: "" });

		expect(await resolveConfirmation(input)).toBe("/login?error=auth_failed");
		expect(calls).toEqual(["clear"]);
	});

	it("si no se puede abrir la sesión manda al login con el error", async () => {
		const { input, calls } = deps({ opens: false });

		expect(await resolveConfirmation(input)).toBe("/login?error=auth_failed");
		expect(calls).toEqual(["clear", "open"]);
	});

	it("si aceptar falla igual manda al destino: la sesión ya está abierta", async () => {
		const { input } = deps({ acceptThrows: true });

		expect(await resolveConfirmation(input)).toBe("/acme/chat");
	});

	it("sin next manda a la raíz, que elige empresa", async () => {
		expect(await resolveConfirmation(deps({ next: null }).input)).toBe("/");
	});

	it("un next hacia otro origen o con doble barra se descarta", async () => {
		expect(
			await resolveConfirmation(deps({ next: "https://evil.test/x" }).input),
		).toBe("/");
		expect(await resolveConfirmation(deps({ next: "//evil.test" }).input)).toBe(
			"/",
		);
	});
	it("si el método no está permitido cierra la sesión y devuelve la landing", async () => {
		const { input, calls } = deps({
			gate: { ok: false, landing: "/login/acme?error=metodo" },
		});

		expect(await resolveConfirmation(input)).toBe("/login/acme?error=metodo");
		expect(calls).toEqual(["clear", "open", "accept", "gate", "close"]);
	});

	it("si el chequeo tira, corta y cierra la sesión", async () => {
		const { input, calls } = deps({ gateThrows: true });

		expect(await resolveConfirmation(input)).toBe("/login?error=auth_failed");
		expect(calls.at(-1)).toBe("close");
	});

	it("si cerrar la sesión falla, igual devuelve la landing", async () => {
		const { input } = deps({
			gate: { ok: false, landing: "/login/acme?error=metodo" },
			closeThrows: true,
		});

		expect(await resolveConfirmation(input)).toBe("/login/acme?error=metodo");
	});

	it("sin sesión abierta no se chequea ni se cierra nada", async () => {
		const { input, calls } = deps({ opens: false });

		await resolveConfirmation(input);

		expect(calls).not.toContain("gate");
		expect(calls).not.toContain("close");
	});
});

describe("parseSessionFragment", () => {
	it("lee los dos tokens del fragmento de un link de invitación", () => {
		expect(
			parseSessionFragment(
				"#access_token=AAA&expires_in=3600&refresh_token=RRR&token_type=bearer&type=invite",
			),
		).toEqual({ accessToken: "AAA", refreshToken: "RRR" });
	});

	it("acepta el fragmento sin el numeral", () => {
		expect(parseSessionFragment("access_token=AAA&refresh_token=RRR")).toEqual({
			accessToken: "AAA",
			refreshToken: "RRR",
		});
	});

	it("devuelve null si falta el refresh_token", () => {
		expect(parseSessionFragment("#access_token=AAA")).toBeNull();
	});

	it("devuelve null con un fragmento de error (link vencido)", () => {
		expect(
			parseSessionFragment(
				"#error=access_denied&error_code=otp_expired&error_description=expirado",
			),
		).toBeNull();
	});

	it("devuelve null con un fragmento vacío", () => {
		expect(parseSessionFragment("")).toBeNull();
		expect(parseSessionFragment("#")).toBeNull();
	});
});

describe("emailFromAccessToken", () => {
	const jwt = (payload: unknown) =>
		`h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

	it("lee el correo del payload, sin verificar la firma", () => {
		expect(emailFromAccessToken(jwt({ email: "ana@acme.test" }))).toBe(
			"ana@acme.test",
		);
	});

	it("devuelve null si el payload no trae correo", () => {
		expect(emailFromAccessToken(jwt({ sub: "x" }))).toBeNull();
	});

	it("devuelve null con un token mal formado", () => {
		expect(emailFromAccessToken("basura")).toBeNull();
		expect(emailFromAccessToken("a.%%%.c")).toBeNull();
	});
});

describe("landingPathFor", () => {
	it("deduce la landing de la empresa del next", () => {
		expect(landingPathFor("/acme/chat")).toBe("/login/acme");
	});

	it("sin next o con next que no es de una empresa va al login general", () => {
		expect(landingPathFor(null)).toBe("/login");
		expect(landingPathFor("/")).toBe("/login");
		expect(landingPathFor("//evil.test/chat")).toBe("/login");
	});
});
