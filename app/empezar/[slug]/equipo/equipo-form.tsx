"use client";

import { UsersIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FREE_SEATS, maxInviteRows, seatsUsed } from "@/lib/onboarding/seats";
import { finishWithInvites, finishWithoutInvites } from "./actions";

type Role = "tenant_admin" | "tenant_member";
type Row = { email: string; role: Role };

export function EquipoForm({
	slug,
	domain,
	users,
	pendingInvitations,
}: {
	slug: string;
	domain: string;
	users: number;
	pendingInvitations: number;
}) {
	// Lugares libres del plan gratis, hasta 2 filas.
	const maxRows = maxInviteRows({ users, pendingInvitations });
	const [rows, setRows] = useState<Row[]>(
		Array.from({ length: maxRows }, () => ({
			email: "",
			role: "tenant_member" as Role,
		})),
	);
	const [error, setError] = useState<string | null>(null);
	const [failed, setFailed] = useState<string[]>([]);
	const [outside, setOutside] = useState<string[]>([]);
	const [limited, setLimited] = useState<{
		emails: string[];
		message: string;
	} | null>(null);
	const [pending, startTransition] = useTransition();

	const filled = rows.filter((r) => r.email.trim() !== "");
	const taken = seatsUsed({
		users,
		pendingInvitations,
		filledRows: filled.length,
	});

	function update(index: number, patch: Partial<Row>) {
		setRows((current) =>
			current.map((r, i) => (i === index ? { ...r, ...patch } : r)),
		);
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		startTransition(async () => {
			const result = await finishWithInvites(slug, filled);
			if (!result.ok) {
				setError(result.message);
				return;
			}
			setFailed(result.failed);
			setOutside(result.outside);
			setLimited(result.limited);
		});
	}

	function skip() {
		startTransition(async () => {
			await finishWithoutInvites(slug);
		});
	}

	if (failed.length > 0 || outside.length > 0 || limited) {
		return (
			<div className="space-y-4">
				{outside.map((email) => (
					<p className="text-sm" key={email} role="alert">
						Ese correo no es de @{domain}. Podés invitarlo desde Configuración,
						permitiendo correos de afuera. ({email})
					</p>
				))}
				{limited ? (
					<p className="text-sm" role="alert">
						{limited.message} Quedaron sin invitar: {limited.emails.join(", ")}.
					</p>
				) : null}
				{failed.length > 0 ? (
					<p className="text-sm" role="alert">
						No pudimos mandar el correo a {failed.join(", ")}. Podés volver a
						invitar desde Configuración.
					</p>
				) : null}
				<Button asChild className="w-full" size="lg">
					<a href={`/${slug}/chat`}>Ir al chat</a>
				</Button>
			</div>
		);
	}

	return (
		<form className="space-y-5" noValidate onSubmit={submit}>
			<div className="space-y-2">
				<h1 className="text-2xl leading-tight">
					Tu brain está listo. ¿Invitás a alguien?
				</h1>
				<p className="text-muted-foreground text-sm">
					Con el plan gratis entran hasta 3 personas, contándote a vos. Les
					llega un correo con el link.
				</p>
			</div>
			{rows.map((row, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: filas fijas, sin reordenar
				<div className="grid grid-cols-[1fr_auto] gap-2" key={index}>
					<div className="space-y-1">
						<label className="block text-sm" htmlFor={`email-${index}`}>
							Correo
						</label>
						<Input
							autoComplete="off"
							id={`email-${index}`}
							onChange={(e) => update(index, { email: e.target.value })}
							placeholder={`nombre@${domain}`}
							type="email"
							value={row.email}
						/>
					</div>
					<div className="space-y-1">
						<label className="block text-sm" htmlFor={`role-${index}`}>
							Rol
						</label>
						<select
							className="h-9 rounded-md border bg-background px-2 text-sm"
							id={`role-${index}`}
							onChange={(e) => update(index, { role: e.target.value as Role })}
							value={row.role}
						>
							<option value="tenant_member">Usuario</option>
							<option value="tenant_admin">Administrador</option>
						</select>
					</div>
				</div>
			))}
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<UsersIcon aria-hidden className="size-4" />
				{taken} de {FREE_SEATS} lugares del plan gratis, contándote a vos
			</p>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<Button
				className="w-full"
				disabled={pending || filled.length === 0}
				size="lg"
				type="submit"
			>
				Mandar invitaciones e ir al chat
			</Button>
			<p className="text-center">
				<button
					className="text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground"
					disabled={pending}
					onClick={skip}
					type="button"
				>
					Ahora no, ir al chat
				</button>
			</p>
		</form>
	);
}
