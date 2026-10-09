"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Connectable } from "@/lib/connect/connectables";
import { copyText } from "@/lib/connect/copy";
import {
	CLIENT_LABELS,
	CLIENTS,
	instructionsFor,
} from "@/lib/connect/instructions";

function CopyButton({ text, label }: { text: string; label: string }) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

	async function copy() {
		const ok = await copyText(
			text,
			typeof navigator === "undefined" ? undefined : navigator.clipboard,
		);
		setState(ok ? "copied" : "failed");
		setTimeout(() => setState("idle"), 2000);
	}

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={copy}
			aria-label={label}
		>
			{state === "copied"
				? "Copiado"
				: state === "failed"
					? "No se pudo copiar"
					: "Copiar"}
		</Button>
	);
}

export function ConnectCard({ connectable }: { connectable: Connectable }) {
	if (connectable.kind === "tools") {
		return (
			<Card className="opacity-70">
				<CardHeader>
					<CardTitle>{connectable.name}</CardTitle>
					<CardDescription>{connectable.description}</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const { id, name, description, url } = connectable;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{name}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-2">
					<input
						readOnly
						value={url}
						aria-label={`URL de ${name}`}
						onFocus={(event) => event.currentTarget.select()}
						className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-1.5 font-mono text-xs"
					/>
					<CopyButton text={url} label={`Copiar la URL de ${name}`} />
				</div>

				<Tabs defaultValue={CLIENTS[0]}>
					<div className="overflow-x-auto">
						<TabsList>
							{CLIENTS.map((client) => (
								<TabsTrigger key={client} value={client}>
									{CLIENT_LABELS[client]}
									{instructionsFor(client, { id, url }).tested ? null : (
										<span className="ml-1 rounded-full border px-1.5 text-[10px] text-muted-foreground">
											Sin probar
										</span>
									)}
								</TabsTrigger>
							))}
						</TabsList>
					</div>
					{CLIENTS.map((client) => {
						const { steps, snippet } = instructionsFor(client, { id, url });
						return (
							<TabsContent key={client} value={client} className="space-y-3">
								<ol className="list-decimal space-y-1 pl-5">
									{steps.map((step) => (
										<li key={step}>{step}</li>
									))}
								</ol>
								{snippet ? (
									<div className="space-y-2">
										<pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
											<code>{snippet.code}</code>
										</pre>
										<CopyButton
											text={snippet.code}
											label={`Copiar el ${snippet.language === "json" ? "JSON" : "comando"} de ${CLIENT_LABELS[client]}`}
										/>
									</div>
								) : null}
							</TabsContent>
						);
					})}
				</Tabs>
			</CardContent>
		</Card>
	);
}
