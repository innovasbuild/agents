import { FileSpreadsheetIcon, FileTextIcon, XIcon } from "lucide-react";
import { attachmentKind, attachmentMeta } from "@/lib/agents/attachment";

/**
 * Tarjeta de un archivo adjunto: ícono, nombre y "TIPO · tamaño". Es la misma
 * en el compositor (con `onRemove`, para quitarlo antes de enviar) y en el
 * mensaje ya enviado (solo lectura).
 */
export function AttachmentCard({
	filename,
	mediaType,
	size,
	onRemove,
}: {
	filename: string | undefined;
	mediaType: string | undefined;
	size: number | undefined;
	onRemove?: () => void;
}) {
	const Icon =
		attachmentKind(filename, mediaType) === "sheet"
			? FileSpreadsheetIcon
			: FileTextIcon;
	const name = filename ?? "Archivo adjunto";

	return (
		<div className="relative flex w-fit max-w-full items-center gap-3 rounded-xl border bg-card py-2 pr-4 pl-2">
			<span
				aria-hidden="true"
				className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
			>
				<Icon className="size-5" />
			</span>
			<span className="min-w-0">
				<span
					className="block max-w-56 truncate font-medium text-sm"
					title={name}
				>
					{name}
				</span>
				<span className="block text-muted-foreground text-xs">
					{attachmentMeta(filename, size)}
				</span>
			</span>
			{onRemove ? (
				<button
					aria-label="Quitar archivo adjunto"
					className="-top-2 -right-2 absolute flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
					onClick={onRemove}
					type="button"
				>
					<XIcon className="size-3" />
				</button>
			) : null}
		</div>
	);
}
