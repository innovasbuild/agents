import type { ReservedNotice } from "@/lib/brain/core/editor/reserved";

const count = (n: number) => n.toLocaleString("es-AR");

// Aviso arriba del editor de una página reservada (spec etapa 26 §4.1): qué
// gobierna, quién la escribe y su tope. El tope lo exige el servidor al guardar
// una 00-reglas activa; acá solo se muestra.
export function ReservedNoticeBox({
	notice,
	length,
}: {
	notice: ReservedNotice;
	length: number;
}) {
	const over = notice.limit !== null && length > notice.limit;
	return (
		<div
			role="note"
			className="space-y-1 rounded-lg border bg-muted/50 p-4 text-sm"
		>
			<p className="font-medium">{notice.title}</p>
			<p className="text-muted-foreground">{notice.text}</p>
			{notice.limit !== null && (
				<>
					<p className="text-muted-foreground">
						Una regla en borrador no aplica.
					</p>
					<p
						className={
							over ? "font-medium text-destructive" : "text-muted-foreground"
						}
					>
						{count(length)} de {count(notice.limit)} caracteres
						{over ? ": así no se puede guardar activa." : ""}
					</p>
				</>
			)}
		</div>
	);
}
