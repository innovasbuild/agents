// app/chat/page.tsx — andamio para probar la cola de aprobación de send_email.
// No es la UI del producto: la Etapa 4 lo reemplaza con /cola.
"use client";

import { useEveAgent } from "eve/react";
import { useState } from "react";

// Forma esperada del input de send_email (agents/outreach/tools/send_email.ts).
interface SendEmailInput {
	to?: string;
	subject?: string;
	body?: string;
}

export default function ChatPage() {
	const agent = useEveAgent({ agent: "outreach" });
	const [text, setText] = useState("");

	const isBusy = agent.status === "submitted" || agent.status === "streaming";
	const isResuming = agent.status === "resuming";

	// Doc local (guides/frontend/overview.mdx#human-in-the-loop-prompts): el
	// input request pendiente vive en part.toolMetadata.eve.inputRequest y trae
	// requestId/kind/prompt/options, pero NO el input de la tool. Ese input
	// (destinatario/asunto/cuerpo) está en el propio dynamic-tool part, en
	// `part.input`, cuando `part.state === "approval-requested"`
	// (dist/src/client/message-reducer-types.d.ts). Por eso combinamos ambos.
	const pendingApprovals = agent.data.messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (part.type !== "dynamic-tool" || part.state !== "approval-requested") {
				return [];
			}
			const request = part.toolMetadata?.eve?.inputRequest;
			if (!request) return [];
			return [{ requestId: request.requestId, input: part.input as SendEmailInput }];
		}),
	);

	return (
		<main>
			<h1>Chat outreach</h1>

			<section>
				{agent.data.messages.map((message) => (
					<article key={message.id}>
						<strong>{message.role}:</strong>{" "}
						{message.parts.map((part, index) =>
							part.type === "text" ? <span key={index}>{part.text}</span> : null,
						)}
					</article>
				))}
			</section>

			{pendingApprovals.map(({ requestId, input }) => (
				<fieldset key={requestId}>
					<legend>Aprobación pendiente: enviar email</legend>
					<p>
						<strong>Para:</strong> {input.to ?? "(sin destinatario)"}
					</p>
					<p>
						<strong>Asunto:</strong> {input.subject ?? "(sin asunto)"}
					</p>
					<p style={{ whiteSpace: "pre-wrap" }}>
						<strong>Cuerpo:</strong>
						{"\n"}
						{input.body ?? "(sin cuerpo)"}
					</p>
					<button
						type="button"
						onClick={() =>
							void agent.respond([{ requestId, optionId: "approve" }])
						}
					>
						Aprobar
					</button>
					<button
						type="button"
						onClick={() =>
							void agent.respond([{ requestId, optionId: "cancel" }])
						}
					>
						Rechazar
					</button>
				</fieldset>
			))}

			<form
				onSubmit={(event) => {
					event.preventDefault();
					const message = text.trim();
					if (message.length > 0 && !isResuming) {
						void agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
						setText("");
					}
				}}
			>
				<input
					disabled={isResuming}
					value={text}
					onChange={(event) => setText(event.target.value)}
					placeholder="Escribí un mensaje para el agente de outreach"
				/>
				<button disabled={isResuming} type="submit">
					Enviar
				</button>
			</form>
		</main>
	);
}
