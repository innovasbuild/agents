"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
	ConfigOption,
	ConfigOptionsByKind,
} from "@/lib/outreach/focus-query";
import type { FocusFunnel, FocusRow } from "@/lib/outreach/store";
import { createFocus } from "./actions";

const STATUS_LABELS: Record<FocusRow["status"], string> = {
	activo: "Activo",
	agotado: "Agotado",
	cancelado: "Cancelado",
};

const CRITERIA_PLACEHOLDER = `{
  "locations": ["Argentina"],
  "keywords": ["riego"]
}`;

export function FocosClient({
	slug,
	focuses,
	funnels,
	options,
}: {
	slug: string;
	focuses: FocusRow[];
	funnels: FocusFunnel[];
	options: ConfigOptionsByKind;
}) {
	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="font-semibold text-2xl tracking-display">Focos</h1>
				<p className="text-muted-foreground text-sm">
					{focuses.length === 0
						? "Todavía no hay focos de búsqueda."
						: `${focuses.length} ${focuses.length === 1 ? "foco" : "focos"}.`}
				</p>
			</header>

			<NuevoFocoForm options={options} slug={slug} />

			{focuses.length === 0 ? null : (
				<ul className="flex flex-col gap-4">
					{focuses.map((focus, index) => (
						<li key={focus.id}>
							<FocoCard focus={focus} funnel={funnels[index]} slug={slug} />
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function NuevoFocoForm({
	slug,
	options,
}: {
	slug: string;
	options: ConfigOptionsByKind;
}) {
	const router = useRouter();
	const [name, setName] = useState("");
	const [criteriaText, setCriteriaText] = useState("");
	const [vector, setVector] = useState(options.vector[0]?.value ?? "");
	const [segment, setSegment] = useState(options.segmento[0]?.value ?? "");
	const [hook, setHook] = useState(options.hook[0]?.value ?? "");
	const [idioma, setIdioma] = useState(options.idioma[0]?.value ?? "");
	const [maxAccounts, setMaxAccounts] = useState("50");
	const [maxContacts, setMaxContacts] = useState("200");
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	// Sin las cuatro listas no hay con qué armar el formulario: mejor decirlo
	// que dejar selects vacíos que igual fallarían la validación del servidor.
	const sinListas =
		options.vector.length === 0 ||
		options.segmento.length === 0 ||
		options.hook.length === 0 ||
		options.idioma.length === 0;

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setMessage(null);

		// El criterio se valida acá como JSON antes de mandarlo: parseFocusForm
		// (server) valida la forma del objeto, no si el texto es JSON válido.
		let criteria: unknown;
		try {
			criteria = criteriaText.trim() === "" ? {} : JSON.parse(criteriaText);
		} catch {
			setMessage("El criterio no es un JSON válido.");
			return;
		}

		startTransition(async () => {
			const result = await createFocus(slug, {
				name,
				criteria,
				vector,
				segment,
				hook,
				idioma,
				maxAccounts: Number(maxAccounts),
				maxContacts: Number(maxContacts),
			});
			if (!result.ok) {
				setMessage(result.message);
				return;
			}
			setName("");
			setCriteriaText("");
			router.refresh();
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Nuevo foco</CardTitle>
			</CardHeader>
			<form onSubmit={handleSubmit}>
				<CardContent className="space-y-3">
					{sinListas ? (
						<p className="text-destructive text-sm">
							Faltan listas de configuración (vector, segmento, hook o idioma).
							Cargalas antes de crear un foco.
						</p>
					) : (
						<>
							<Input
								aria-label="Nombre del foco"
								disabled={isPending}
								onChange={(event) => setName(event.target.value)}
								placeholder="Nombre del foco"
								required
								value={name}
							/>
							<Textarea
								aria-label="Criterio (JSON)"
								disabled={isPending}
								onChange={(event) => setCriteriaText(event.target.value)}
								placeholder={CRITERIA_PLACEHOLDER}
								rows={5}
								value={criteriaText}
							/>
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
								<Selector
									disabled={isPending}
									label="Vector"
									onChange={setVector}
									options={options.vector}
									value={vector}
								/>
								<Selector
									disabled={isPending}
									label="Segmento"
									onChange={setSegment}
									options={options.segmento}
									value={segment}
								/>
								<Selector
									disabled={isPending}
									label="Hook"
									onChange={setHook}
									options={options.hook}
									value={hook}
								/>
								<Selector
									disabled={isPending}
									label="Idioma"
									onChange={setIdioma}
									options={options.idioma}
									value={idioma}
								/>
							</div>
							<div className="grid grid-cols-2 gap-3 sm:max-w-xs">
								<label
									className="flex flex-col gap-1 text-sm"
									htmlFor="max-accounts"
								>
									Cupo de empresas
									<Input
										disabled={isPending}
										id="max-accounts"
										min={1}
										onChange={(event) => setMaxAccounts(event.target.value)}
										type="number"
										value={maxAccounts}
									/>
								</label>
								<label
									className="flex flex-col gap-1 text-sm"
									htmlFor="max-contacts"
								>
									Cupo de contactos
									<Input
										disabled={isPending}
										id="max-contacts"
										min={1}
										onChange={(event) => setMaxContacts(event.target.value)}
										type="number"
										value={maxContacts}
									/>
								</label>
							</div>
						</>
					)}
					{message ? (
						<p className="text-destructive text-sm">{message}</p>
					) : null}
				</CardContent>
				<CardFooter>
					<Button disabled={isPending || sinListas} type="submit">
						Crear foco
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}

function Selector({
	label,
	options,
	value,
	disabled,
	onChange,
}: {
	label: string;
	options: ConfigOption[];
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	return (
		<label className="flex flex-col gap-1 text-sm">
			{label}
			<select
				className="h-11 rounded-md border bg-background px-3 text-sm"
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				value={value}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

function FocoCard({
	slug,
	focus,
	funnel,
}: {
	slug: string;
	focus: FocusRow;
	funnel: FocusFunnel;
}) {
	// Solo un foco activo con algo para revisar linkea a la bandeja: uno
	// agotado o cancelado ya no suma más para_revisar (spec §9.2).
	const linkeaARevisar = focus.status === "activo" && funnel.paraRevisar > 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{focus.name}
					<span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
						{STATUS_LABELS[focus.status]}
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
					<dt className="text-muted-foreground">Empresas</dt>
					<dd className="tabular-nums">
						{focus.accountsFound}/{focus.maxAccounts}
					</dd>
					<dt className="text-muted-foreground">Contactos</dt>
					<dd className="tabular-nums">
						{focus.contactsFound}/{focus.maxContacts}
					</dd>
					<dt className="text-muted-foreground">Vector</dt>
					<dd>{focus.vector}</dd>
					<dt className="text-muted-foreground">Hook</dt>
					<dd>{focus.hook}</dd>
				</dl>

				<div className="rounded-md border bg-muted/30 p-3 text-sm">
					<p className="font-medium">Embudo</p>
					<p className="mt-1 tabular-nums">
						{funnel.descubiertos} descubiertos → {funnel.calificados}{" "}
						calificados → {funnel.enriquecidos} enriquecidos →{" "}
						{funnel.encolados} encolados → {funnel.enviados} enviados
					</p>
					<p className="mt-1 text-muted-foreground tabular-nums">
						{funnel.descartados} descartados · {funnel.paraRevisar} para revisar
					</p>
				</div>

				{linkeaARevisar ? (
					<Link
						className="inline-block text-sm underline underline-offset-4"
						href={`/${slug}/focos/${focus.id}/revisar`}
					>
						Ver {funnel.paraRevisar} para revisar
					</Link>
				) : null}
			</CardContent>
		</Card>
	);
}
