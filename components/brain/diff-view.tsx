import type { DiffBlock } from "@/lib/brain/core/diff";

// Bloques iguales largos se colapsan dejando `context` líneas a cada lado.
export function DiffView({
	blocks,
	context = 3,
}: {
	blocks: DiffBlock[];
	context?: number;
}) {
	if (blocks.every((b) => b.kind === "equal"))
		return (
			<p className="text-muted-foreground text-sm">Sin cambios en el cuerpo.</p>
		);
	return (
		<pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
			{blocks.map((block, i) => {
				if (block.kind === "equal" && block.lines.length > context * 2 + 1) {
					const head = i === 0 ? [] : block.lines.slice(0, context);
					const tail =
						i === blocks.length - 1 ? [] : block.lines.slice(-context);
					const hidden = block.lines.length - head.length - tail.length;
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: bloques de diff sin id estable
						<div key={i}>
							{head.map((l, j) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: bloques de diff sin id estable
								<div key={`h${j}`}>{`  ${l}`}</div>
							))}
							<div className="text-muted-foreground">{`  … ${hidden} líneas sin cambios`}</div>
							{tail.map((l, j) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: bloques de diff sin id estable
								<div key={`t${j}`}>{`  ${l}`}</div>
							))}
						</div>
					);
				}
				const cls =
					block.kind === "added"
						? "bg-green-500/15"
						: block.kind === "removed"
							? "bg-red-500/15"
							: "";
				const mark =
					block.kind === "added"
						? "+ "
						: block.kind === "removed"
							? "- "
							: "  ";
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: bloques de diff sin id estable
					<div key={i} className={cls}>
						{block.lines.map((l, j) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: bloques de diff sin id estable
							<div key={j}>{mark + l}</div>
						))}
					</div>
				);
			})}
		</pre>
	);
}
