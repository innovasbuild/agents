"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function InviteForm({ tenantId }: { tenantId: string }) {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [message, setMessage] = useState<string | null>(null);

	async function invite(allowExternal: boolean) {
		setMessage(null);
		const response = await fetch("/api/invitations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tenantId,
				email,
				role: "tenant_member",
				allowExternal,
			}),
		});

		if (response.status === 422) {
			setMessage(
				"Ese mail está fuera de los dominios del cliente. ¿Invitar igual?",
			);
			return;
		}
		if (!response.ok) {
			setMessage("No se pudo invitar. Revisá el mail e intentá de nuevo.");
			return;
		}

		setEmail("");
		setMessage("Invitación enviada.");
		router.refresh();
	}

	return (
		<section className="space-y-2">
			<h2 className="font-semibold">Invitar</h2>
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void invite(false);
				}}
			>
				<input
					className="rounded border px-3 py-2"
					onChange={(event) => setEmail(event.target.value)}
					placeholder="mail@cliente.com"
					type="email"
					value={email}
				/>
				<Button type="submit">Invitar</Button>
			</form>
			{message ? (
				<p className="text-muted-foreground text-sm">
					{message}{" "}
					{message.startsWith("Ese mail") ? (
						<button
							className="underline"
							onClick={() => void invite(true)}
							type="button"
						>
							Invitar igual
						</button>
					) : null}
				</p>
			) : null}
		</section>
	);
}
