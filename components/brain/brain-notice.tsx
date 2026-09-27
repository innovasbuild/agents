export function BrainNotice({ kind }: { kind: "no-brain" | "external" }) {
	return (
		<div className="max-w-xl rounded-lg border p-6">
			<h1 className="mb-2 text-2xl">Brain</h1>
			<p className="text-muted-foreground">
				{kind === "no-brain"
					? "Este cliente no tiene brain configurado."
					: "Este brain vive en un servidor externo; se edita en su origen."}
			</p>
		</div>
	);
}
