"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLE_LABELS } from "@/lib/tenants/role-labels";

export function InviteForm({ tenantId }: { tenantId: string }) {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"tenant_admin" | "tenant_member">(
		"tenant_member",
	);
	const [message, setMessage] = useState<string | null>(null);

	async function invite(allowExternal: boolean) {
		setMessage(null);
		const response = await fetch("/api/invitations", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tenantId,
				email,
				role,
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
		<section className="space-y-3">
			<h2 className="text-lg">Invitar</h2>
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void invite(false);
				}}
			>
				<Input
					aria-label="Mail a invitar"
					className="max-w-xs"
					onChange={(event) => setEmail(event.target.value)}
					placeholder="mail@cliente.com"
					type="email"
					value={email}
				/>
				<select
					aria-label="Rol"
					className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
					onChange={(event) =>
						setRole(event.target.value as "tenant_admin" | "tenant_member")
					}
					value={role}
				>
					<option value="tenant_member">{ROLE_LABELS.tenant_member}</option>
					<option value="tenant_admin">{ROLE_LABELS.tenant_admin}</option>
				</select>
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
