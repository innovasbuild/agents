"use client";

import type { EveMessage } from "eve/client";
import { useEveAgent } from "eve/react";
import { EllipsisIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { pendingInputRequests } from "@/lib/agents/input-requests";
import { runningToolLabel, runningToolName } from "@/lib/agents/running-tool";
import {
	createConversation,
	deleteConversation,
	renameConversation,
} from "./actions";

interface Thread {
	id: string;
	title: string | null;
	model: string | null;
	eve_session_id: string | null;
	last_message_at: string;
}

interface SendEmailInput {
	queueItemId?: string;
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
		<div className="grid gap-6 md:grid-cols-[240px_1fr] md:gap-8">
			<aside className="space-y-4">
				<div className="space-y-2">
					<label
						className="block text-muted-foreground text-sm"
						htmlFor="modelo"
					>
						Modelo del hilo nuevo
					</label>
					<select
						className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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

				<ul className="space-y-0.5">
					{threads.map((thread) => {
						const isActive = thread.id === active?.id;
						return (
							<li
								className={`flex items-center rounded-md transition-colors hover:bg-muted ${
									isActive ? "bg-muted font-medium" : ""
								}`}
								key={thread.id}
							>
								<a
									className={`min-w-0 flex-1 truncate rounded-md py-2 pl-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
										isActive ? "" : "text-muted-foreground"
									}`}
									href={`/${slug}/chat?hilo=${thread.id}`}
								>
									{threadTitle(thread)}
								</a>
								<ThreadMenu isActive={isActive} slug={slug} thread={thread} />
							</li>
						);
					})}
				</ul>
			</aside>

			{active ? (
				<Thread key={active.id} slug={slug} thread={active} />
			) : (
				<div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed p-8 text-center">
					<p className="text-muted-foreground">
						Elegí un hilo o abrí uno nuevo para hablar con el agente.
					</p>
				</div>
			)}
		</div>
	);
}

function threadTitle(thread: Thread): string {
	return thread.title ?? "Hilo sin título";
}

function ThreadMenu({
	isActive,
	slug,
	thread,
}: {
	isActive: boolean;
	slug: string;
	thread: Thread;
}) {
	const router = useRouter();
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const title = threadTitle(thread);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					{/* El área táctil se estira más allá del botón: abajo de 768px la
					    lista de hilos es la navegación principal en un teléfono. */}
					<Button
						aria-label={`Opciones de ${title}`}
						className="relative mr-1 text-muted-foreground after:absolute after:-inset-1"
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						onSelect={(event) => {
							// Sin esto el menú devuelve el foco al trigger mientras el
							// diálogo instala su trampa, y las dos capas se pisan.
							event.preventDefault();
							setError(null);
							setConfirming(true);
						}}
						variant="destructive"
					>
						Borrar conversación
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Esc y el click afuera también cierran el diálogo, y con el borrado
			    en vuelo eso desmonta la única superficie donde se ve el error. */}
			<AlertDialog
				onOpenChange={(open) => {
					if (!pending) setConfirming(open);
				}}
				open={confirming}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>¿Borrar “{title}”?</AlertDialogTitle>
						<AlertDialogDescription>
							Se borra el hilo y su historial de esta pantalla, sin vuelta
							atrás. Los envíos que ya salieron y lo que quedó en el CRM no se
							tocan. Si el agente está trabajando en este hilo, borrarlo no lo
							frena: el turno sigue hasta el final y un envío ya aprobado va a
							salir igual.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{error ? (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
						{/* Botón suelto y no AlertDialogAction: Action cierra el diálogo
						    al click y el borrado tiene que poder fallar a la vista. */}
						<Button
							disabled={pending}
							onClick={() => {
								setError(null);
								startTransition(async () => {
									const result = await deleteConversation(thread.id, slug);
									if (!result.ok) {
										setError(result.error);
										return;
									}
									setConfirming(false);
									// El hilo abierto dejó de existir: la URL con ?hilo= no
									// resuelve a nada y la pantalla quedaría en el vacío. Si
									// el borrado fue de otro hilo no hace falta refrescar: el
									// revalidatePath de la action ya vuelve con la lista al día.
									if (isActive) router.replace(`/${slug}/chat`);
								});
							}}
							type="button"
							variant="destructive"
						>
							{pending ? "Borrando…" : "Borrar"}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
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

	// Aprobaciones de tools y preguntas del agente (ask_question) llegan igual;
	// cada una se responde con el id de sus propias opciones.
	const pendingRequests = pendingInputRequests(agent.data.messages);

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

	// Indicador de trabajo en curso. Tres reglas: con una tarjeta pendiente la
	// señal es la tarjeta y no los puntitos; con texto ya llegando el propio
	// texto es el indicador; y en los tramos largos de tool conviene decir en
	// qué anda, que es donde "Pensando…" a secas no distingue trabado de
	// laburando.
	const runningTool = useMemo(
		() => runningToolName(agent.data.messages),
		[agent.data.messages],
	);
	const isThinking =
		(isResuming || agent.status === "submitted" || runningTool !== null) &&
		!isAuthorizing &&
		pendingRequests.length === 0;

	// Con una tarjeta pendiente el input principal se bloquea: eve resuelve el
	// texto contra las opciones (id, etiqueta o número, channel/resolve-text.js),
	// así que escribir "1" aprobaría un send_email sin pasar por la tarjeta.
	// Tras un error también: eve oculta la tarjeta antes de que su respuesta
	// llegue al servidor y no la restaura si falla, así que el pedido puede
	// seguir abierto sin tarjeta (client/eve-agent-store.js).
	const isInputBlocked =
		isResuming ||
		isAuthorizing ||
		pendingRequests.length > 0 ||
		agent.status === "error";
	// eve rechaza respond() con un turno en vuelo o mientras reanuda.
	const canAnswer = !isBusy && !isResuming;

	return (
		<section className="min-w-0 space-y-6">
			<p className="text-muted-foreground text-sm">
				Modelo del hilo: <code>{thread.model ?? "el default del cliente"}</code>
				. eve fija el modelo al abrir la sesión: para usar otro, abrí un hilo
				nuevo.
			</p>

			<div className="space-y-4">
				{agent.data.messages.map((message) =>
					message.role === "user" ? (
						<article
							className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-4 py-2.5"
							key={message.id}
						>
							<span className="sr-only">Vos: </span>
							<MessageText message={message} />
						</article>
					) : (
						<article
							className="max-w-[85%] whitespace-pre-wrap leading-relaxed"
							key={message.id}
						>
							<span className="sr-only">Agente: </span>
							<MessageText message={message} />
						</article>
					),
				)}
			</div>

			{/* La región vive siempre: un role="status" que se monta junto con su
			    texto no lo anuncia en la mayoría de los lectores de pantalla. */}
			<p
				className="flex items-center gap-2 text-muted-foreground text-sm empty:hidden"
				role="status"
			>
				{isThinking ? (
					<>
						<span aria-hidden="true" className="flex gap-1">
							<span className="size-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none" />
							<span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms] motion-reduce:animate-none" />
							<span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms] motion-reduce:animate-none" />
						</span>
						{isResuming
							? "Reanudando el hilo…"
							: runningTool
								? `${runningToolLabel(runningTool)}…`
								: "Pensando…"}
					</>
				) : null}
			</p>

			{pendingAuthorizations.map(({ key, part }) => (
				<fieldset className="rounded-lg border bg-card p-4" key={key}>
					<legend className="px-1 font-medium text-sm">
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

			{pendingRequests.map((request) => (
				<fieldset
					className="space-y-2 rounded-lg border bg-card p-4"
					key={request.requestId}
				>
					{request.kind !== "tool-approval" ? (
						<>
							<legend className="px-1 font-medium text-sm">
								{request.kind === "session-limit"
									? "Límite de la sesión"
									: "Pregunta del agente"}
							</legend>
							<p className="whitespace-pre-wrap">{request.prompt}</p>
						</>
					) : request.toolName === "send_email" ? (
						<>
							<legend className="px-1 font-medium text-sm">
								Aprobación pendiente: enviar email
							</legend>
							{(() => {
								const emailInput = request.input as SendEmailInput;
								return (
									<>
										<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
											<dt className="text-muted-foreground">Para</dt>
											<dd>{emailInput.to ?? "(sin destinatario)"}</dd>
											<dt className="text-muted-foreground">Asunto</dt>
											<dd>{emailInput.subject ?? "(sin asunto)"}</dd>
										</dl>
										<p className="whitespace-pre-wrap rounded-md border bg-background p-3">
											<span className="sr-only">Cuerpo: </span>
											{emailInput.body ?? "(sin cuerpo)"}
										</p>
									</>
								);
							})()}
						</>
					) : (
						<>
							<legend className="px-1 font-medium text-sm">
								Aprobación pendiente: {request.toolName}
							</legend>
							<pre className="overflow-x-auto whitespace-pre-wrap rounded-md border bg-background p-3 font-mono text-xs">
								{JSON.stringify(request.input, null, 2)}
							</pre>
						</>
					)}
					<div className="flex flex-wrap gap-2 pt-1">
						{request.options.map((option) => (
							<Button
								disabled={!canAnswer}
								key={option.id}
								onClick={() =>
									void agent.respond([
										{ requestId: request.requestId, optionId: option.id },
									])
								}
								type="button"
								variant={
									option.style === "primary"
										? "default"
										: option.style === "danger"
											? "destructive"
											: "outline"
								}
							>
								{option.label}
							</Button>
						))}
					</div>
					{request.allowFreeform ? (
						<FreeformAnswer
							disabled={!canAnswer}
							hasOptions={request.options.length > 0}
							onAnswer={(answer) =>
								void agent.respond([
									{ requestId: request.requestId, text: answer },
								])
							}
						/>
					) : null}
				</fieldset>
			))}

			{agent.status === "error" ? (
				<p className="text-destructive text-sm" role="alert">
					No se pudo completar el último pedido. Recargá la página; si el aviso
					sigue, el hilo quedó trabado: abrí un hilo nuevo para seguir.
				</p>
			) : null}

			<form
				className="sticky bottom-0 flex gap-2 border-t bg-background py-4"
				onSubmit={(event) => {
					event.preventDefault();
					const message = text.trim();
					if (message.length === 0 || isInputBlocked) return;

					void agent.send(
						message,
						isBusy ? { turnPolicy: "steer" } : undefined,
					);
					if (!thread.title) void renameConversation(thread.id, message, slug);
					setText("");
				}}
			>
				<Input
					aria-label="Mensaje para el agente"
					disabled={isInputBlocked}
					onChange={(event) => setText(event.target.value)}
					placeholder={
						pendingRequests.length > 0
							? "Respondé la tarjeta pendiente para seguir"
							: "Escribí un mensaje para el agente"
					}
					value={text}
				/>
				<Button disabled={isInputBlocked} type="submit">
					Enviar
				</Button>
			</form>
		</section>
	);
}

function FreeformAnswer({
	disabled,
	hasOptions,
	onAnswer,
}: {
	disabled: boolean;
	hasOptions: boolean;
	onAnswer: (answer: string) => void;
}) {
	const [answer, setAnswer] = useState("");

	return (
		<form
			className="mt-2 flex gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				const value = answer.trim();
				if (value.length === 0 || disabled) return;
				onAnswer(value);
				setAnswer("");
			}}
		>
			<Input
				aria-label="Tu respuesta"
				disabled={disabled}
				onChange={(event) => setAnswer(event.target.value)}
				placeholder={
					hasOptions ? "O escribí tu respuesta" : "Escribí tu respuesta"
				}
				value={answer}
			/>
			<Button disabled={disabled} type="submit" variant="outline">
				Responder
			</Button>
		</form>
	);
}

function MessageText({ message }: { message: EveMessage }) {
	return message.parts.map((part) =>
		part.type === "text" ? (
			<span key={`${message.id}-text-${part.stepIndex}`}>{part.text}</span>
		) : null,
	);
}
