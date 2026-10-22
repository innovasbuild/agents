"use client";

import { useState, useTransition } from "react";
import { LoginMethodsField } from "@/components/auth/login-methods-field";
import { Button } from "@/components/ui/button";
import type { AuthMethod } from "@/lib/tenants/auth-methods";
import { saveAuthMethods, saveLogo, saveProfile } from "../perfil-actions";

const COLOR = /^#[0-9a-fA-F]{6}$/;
const input = "block min-h-11 w-full rounded-md border bg-background px-3";

type Feedback = { ok: boolean; text: string } | null;

function Status({ feedback }: { feedback: Feedback }) {
	if (!feedback) return null;
	return (
		<p
			className={feedback.ok ? "text-sm" : "text-destructive text-sm"}
			role={feedback.ok ? "status" : "alert"}
		>
			{feedback.text}
		</p>
	);
}

export function PerfilForm({
	slug,
	displayName,
	primary,
	secondary,
	logoUrl,
	methods: initialMethods,
	currentMethod,
}: {
	slug: string;
	displayName: string;
	primary: string;
	secondary: string;
	logoUrl: string | null;
	methods: AuthMethod[];
	currentMethod: AuthMethod | null;
}) {
	const [name, setName] = useState(displayName);
	const [first, setFirst] = useState(primary);
	const [second, setSecond] = useState(secondary);
	const [methods, setMethods] = useState<AuthMethod[]>(initialMethods);
	const [profileMsg, setProfileMsg] = useState<Feedback>(null);
	const [logoMsg, setLogoMsg] = useState<Feedback>(null);
	const [methodsMsg, setMethodsMsg] = useState<Feedback>(null);
	const [pending, startTransition] = useTransition();

	function submitProfile(event: React.FormEvent) {
		event.preventDefault();
		if (name.trim() === "") {
			setProfileMsg({ ok: false, text: "Poné el nombre de la empresa." });
			return;
		}
		for (const color of [first, second]) {
			if (color !== "" && !COLOR.test(color)) {
				setProfileMsg({
					ok: false,
					text: "Los colores van como #RRGGBB, por ejemplo #1A2B3C.",
				});
				return;
			}
		}
		setProfileMsg(null);
		startTransition(async () => {
			const result = await saveProfile(slug, {
				displayName: name,
				primary: first,
				secondary: second,
			});
			setProfileMsg(
				result.ok
					? { ok: true, text: "Guardado." }
					: { ok: false, text: result.message },
			);
		});
	}

	function submitLogo(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		setLogoMsg(null);
		startTransition(async () => {
			const result = await saveLogo(slug, formData);
			setLogoMsg(
				result.ok
					? { ok: true, text: "Logo actualizado." }
					: { ok: false, text: result.message },
			);
		});
	}

	function submitMethods(event: React.FormEvent) {
		event.preventDefault();
		if (methods.length === 0) {
			setMethodsMsg({ ok: false, text: "Dejá al menos una forma de entrar." });
			return;
		}
		setMethodsMsg(null);
		startTransition(async () => {
			const result = await saveAuthMethods(slug, methods);
			setMethodsMsg(
				result.ok
					? { ok: true, text: "Guardado." }
					: { ok: false, text: result.message },
			);
		});
	}

	return (
		<div className="space-y-10">
			<form className="space-y-4" noValidate onSubmit={submitProfile}>
				<h2 className="text-lg">Nombre y colores</h2>
				<label className="block space-y-1 text-sm">
					<span className="font-medium">Nombre de la empresa</span>
					<input
						className={input}
						disabled={pending}
						maxLength={80}
						onChange={(e) => setName(e.target.value)}
						value={name}
					/>
				</label>
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="block space-y-1 text-sm">
						<span className="font-medium">Color principal</span>
						<input
							className={input}
							disabled={pending}
							onChange={(e) => setFirst(e.target.value)}
							placeholder="#1A2B3C"
							value={first}
						/>
					</label>
					<label className="block space-y-1 text-sm">
						<span className="font-medium">Color secundario</span>
						<input
							className={input}
							disabled={pending}
							onChange={(e) => setSecond(e.target.value)}
							placeholder="#1A2B3C"
							value={second}
						/>
					</label>
				</div>
				<Button disabled={pending} size="lg" type="submit">
					Guardar
				</Button>
				<Status feedback={profileMsg} />
			</form>

			<form className="space-y-4" onSubmit={submitLogo}>
				<h2 className="text-lg">Logo</h2>
				{logoUrl ? (
					// biome-ignore lint/performance/noImgElement: logo público del bucket de marca
					<img alt="Logo actual" className="max-h-16" src={logoUrl} />
				) : (
					<p className="text-muted-foreground text-sm">Todavía no hay logo.</p>
				)}
				<input
					accept="image/png,image/svg+xml,image/webp"
					className="block text-sm"
					disabled={pending}
					name="logo"
					required
					type="file"
				/>
				<p className="text-muted-foreground text-xs">
					PNG, SVG o WebP, hasta 1 MB.
				</p>
				<Button disabled={pending} size="lg" type="submit">
					Subir logo
				</Button>
				<Status feedback={logoMsg} />
			</form>

			<form className="space-y-4" noValidate onSubmit={submitMethods}>
				<fieldset className="space-y-3">
					<legend className="mb-2 text-lg">Formas de entrar</legend>
					<LoginMethodsField
						currentMethod={currentMethod}
						disabled={pending}
						methods={methods}
						onToggle={(value, checked) =>
							setMethods((current) =>
								checked
									? [...current, value]
									: current.filter((m) => m !== value),
							)
						}
					/>
				</fieldset>
				<Button disabled={pending} size="lg" type="submit">
					Guardar
				</Button>
				<Status feedback={methodsMsg} />
			</form>
		</div>
	);
}
