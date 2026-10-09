import { afterEach, describe, expect, it, vi } from "vitest";
import { closeLocalSession } from "@/lib/auth/close-session";

describe("closeLocalSession", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("cierra solo la sesión recién abierta (scope local), no las de otros dispositivos", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const signOut = vi.fn(async (_options: { scope: "local" }) => ({
			error: null,
		}));

		await closeLocalSession({ auth: { signOut } });

		expect(signOut).toHaveBeenCalledTimes(1);
		expect(signOut).toHaveBeenCalledWith({ scope: "local" });
		expect(error).not.toHaveBeenCalled();
	});

	it("si signOut devuelve un error lo deja en el log y no tira", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = { message: "sesión inexistente" };

		await expect(
			closeLocalSession({
				auth: { signOut: async () => ({ error: failure }) },
			}),
		).resolves.toBeUndefined();

		expect(error).toHaveBeenCalledTimes(1);
		expect(error.mock.calls[0]).toContain(failure);
	});

	it("si signOut tira lo deja en el log y no tira", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = new Error("red");

		await expect(
			closeLocalSession({
				auth: {
					signOut: async () => {
						throw failure;
					},
				},
			}),
		).resolves.toBeUndefined();

		expect(error).toHaveBeenCalledTimes(1);
		expect(error.mock.calls[0]).toContain(failure);
	});
});
