"use client";

import { useEveAgent } from "eve/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createConversation, renameConversation } from "./actions";

interface Thread {
	id: string;
	title: string | null;
	model: string | null;
	eve_session_id: string | null;
	last_message_at: string;
}

interface SendEmailInput {
	to?: string;
	subject?: string;
	body?: string;
}

export function ChatClient({
	active,
	allowedModels,
	defaultModel,
	slug,
	tenantId,
	threads,
}: {
	active: Thread | null;
	allowedModels: string[];
	defaultModel: string;
	slug: string;
	tenantId: string;
	threads: Thread[];
}) {
	const router = useRouter();
	const [model, setModel] = useState(defaultModel);

	return (
		<div className="grid gap-6 md:grid-cols-[240px_1fr]">
			<aside className="space-y-3">
				<div className="space-y-2">
					<label
						className="block text-muted-foreground text-sm"
						htmlFor="modelo"
					>
						Modelo del hilo nuevo
					</label>
					<select
						className="w-full rounded border px-2 py-1"
						id="modelo"
						onChange={(event) => setModel(event.target.value)}
						value={model}
					>
						{allowedModels.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
					<Button
						className="w-full"
						onClick={async () => {
							const id = await createConversation(tenantId, slug, model);
							if (id) router.push(`/${slug}/chat?hilo=${id}`);
						}}
						type="button"
					>
						Hilo nuevo
					</Button>
				</div>

				<ul className="space-y-1">
					{threads.map((thread) => (
						<li key={thread.id}>
							<a
								className={`block truncate rounded px-2 py-1 text-sm ${
									thread.id === active?.id ? "bg-muted font-medium" : ""
								}`}
								href={`/${slug}/chat?hilo=${thread.id}`}
							>
								{thread.title ?? "Hilo sin título"}
							</a>
						</li>
					))}
				</ul>
			</aside>

			{active ? (
				<Thread key={active.id} slug={slug} thread={active} />
			) : (
				<p className="text-muted-foreground">
					Elegí un hilo o abrí uno nuevo para hablar con el agente.
				</p>
			)}
		</div>
	);
}

function Thread({ slug, thread }: { slug: string; thread: Thread }) {
	const [text, setText] = useState("");

	// eve_session_id lo ata únicamente bind-session.ts (hook server-side de
	// eve), de forma asíncrona cuando arranca la sesión con
	// ctx.session.id — nunca un valor que venga del cliente. Un refresh o
	// remount inmediatamente después del primer mensaje de un hilo nuevo,
	// antes de que el hook termine, puede reabrir el hilo sin poder resumir
	// esa sesión puntual; es una molestia rara y menor, no una falla
	// funcional: el turno se completa igual y queda en `runs`, y la próxima
	// vez que se abra el hilo el eve_session_id ya va a estar escrito.
	const agent = useEveAgent({
		agent: "outreach",
		headers: { "x-innovas-conversation": thread.id },
		...(thread.eve_session_id
			? {
					initialSession: { sessionId: thread.eve_session_id, streamIndex: 0 },
					resume: true,
				}
			: {}),
	});

	const isBusy = agent.status === "submitted" || agent.status === "streaming";
	const isResuming = agent.status === "resuming";

	// El input pendiente de la tool vive en part.input del dynamic-tool con
	// state "approval-requested"; el requestId, en toolMetadata.eve.inputRequest.
	const pendingApprovals = agent.data.messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (part.type !== "dynamic-tool" || part.state !== "approval-requested")
				return [];
			const request = part.toolMetadata?.eve?.inputRequest;
			if (!request) return [];
			return [
				{ requestId: request.requestId, input: part.input as SendEmailInput },
			];
		}),
	);

	// Mientras haya una autorización pendiente, el turno está parqueado: se
	// muestra el botón y se bloquea el input (guides/client/streaming.mdx).
	const pendingAuthorizations = agent.data.messages.flatMap((message) =>
		message.parts.flatMap((part) =>
			part.type === "authorization" && part.state === "required"
				? [{ key: `${part.turnId}-${part.stepIndex}-${part.name}`, part }]
				: [],
		),
	);
	const isAuthorizing = pendingAuthorizations.length > 0;

	return (
		<section className="space-y-4">
			<p className="text-muted-foreground text-sm">
				Modelo del hilo: <code>{thread.model ?? "el default del cliente"}</code>
				. eve fija el modelo al abrir la sesión: para usar otro, abrí un hilo
				nuevo.
			</p>

			<div className="space-y-2">
				{agent.data.messages.map((message) => (
					<article key={message.id}>
						<strong>{message.role}:</strong>{" "}
						{message.parts
							.filter((part) => part.type === "text")
							.map((part) => (
								<span key={`${message.id}-text-${part.stepIndex}`}>
									{part.text}
								</span>
							))}
					</article>
				))}
			</div>

			{pendingAuthorizations.map(({ key, part }) => (
				<fieldset className="rounded border p-3" key={key}>
					<legend className="px-1 text-sm">
						Autorización pendiente: {part.displayName}
					</legend>
					<p className="text-sm">
						{part.authorization?.instructions ??
							`Para seguir, el agente necesita acceso a ${part.displayName} con tu cuenta.`}
					</p>
					{part.authorization?.userCode ? (
						<p className="text-sm">
							Código: <code>{part.authorization.userCode}</code>
						</p>
					) : null}
					{part.authorization?.url ? (
						<Button asChild className="mt-2">
							<a
								href={part.authorization.url}
								rel="noopener noreferrer"
								target="_blank"
							>
								Autorizar {part.displayName}
							</a>
						</Button>
					) : null}
				</fieldset>
			))}

			{pendingApprovals.map(({ requestId, input }) => (
				<fieldset className="rounded border p-3" key={requestId}>
					<legend className="px-1 text-sm">
						Aprobación pendiente: enviar email
					</legend>
					<p>
						<strong>Para:</strong> {input.to ?? "(sin destinatario)"}
					</p>
					<p>
						<strong>Asunto:</strong> {input.subject ?? "(sin asunto)"}
					</p>
					<p className="whitespace-pre-wrap">
						<strong>Cuerpo:</strong>
						{"\n"}
						{input.body ?? "(sin cuerpo)"}
					</p>
					<div className="mt-2 flex gap-2">
						<Button
							onClick={() =>
								void agent.respond([{ requestId, optionId: "approve" }])
							}
							type="button"
						>
							Aprobar
						</Button>
						<Button
							onClick={() =>
								void agent.respond([{ requestId, optionId: "cancel" }])
							}
							type="button"
							variant="outline"
						>
							Rechazar
						</Button>
					</div>
				</fieldset>
			))}

			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					const message = text.trim();
					if (message.length === 0 || isResuming || isAuthorizing) return;

					void agent.send(
						message,
						isBusy ? { turnPolicy: "steer" } : undefined,
					);
					if (!thread.title) void renameConversation(thread.id, message, slug);
					setText("");
				}}
			>
				<input
					className="flex-1 rounded border px-3 py-2"
					disabled={isResuming || isAuthorizing}
					onChange={(event) => setText(event.target.value)}
					placeholder="Escribí un mensaje para el agente"
					value={text}
				/>
				<Button disabled={isResuming || isAuthorizing} type="submit">
					Enviar
				</Button>
			</form>
		</section>
	);
}
