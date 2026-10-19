"use client";

import {
	ArrowUpIcon,
	BotIcon,
	ChevronDownIcon,
	FileIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { canSendMessage } from "@/lib/agents/chat-composer";

/**
 * Un valor que se muestra en el compositor: con `options` se puede cambiar
 * (hilo nuevo); sin ellas es una etiqueta fija (hilo abierto: eve fija el
 * agente y el modelo al abrir la sesión).
 */
export interface ComposerChoice {
	label: string;
	options?: { value: string; label: string }[];
	value?: string;
	onChange?: (value: string) => void;
	hint?: string;
}

function Choice({
	choice,
	icon,
	label,
	variant,
}: {
	choice: ComposerChoice;
	icon?: boolean;
	label: string;
	variant: "muted" | "ghost";
}) {
	const content = (
		<>
			{icon ? <BotIcon aria-hidden /> : null}
			<span className="max-w-48 truncate">{choice.label}</span>
		</>
	);
	if (!choice.options || !choice.onChange) {
		return (
			<span
				className="inline-flex h-8 items-center gap-1.5 px-2.5 text-muted-foreground text-sm"
				title={choice.hint}
			>
				{content}
			</span>
		);
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={label}
					className={
						variant === "ghost"
							? "text-muted-foreground"
							: "bg-muted hover:bg-muted/60"
					}
					size="sm"
					type="button"
					variant="ghost"
				>
					{content}
					<ChevronDownIcon aria-hidden className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-auto min-w-48">
				<DropdownMenuRadioGroup
					onValueChange={choice.onChange}
					value={choice.value}
				>
					{choice.options.map((option) => (
						<DropdownMenuRadioItem
							className="py-2"
							key={option.value}
							value={option.value}
						>
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Compositor del chat: texto arriba; abajo, a la izquierda adjuntar y agente,
 * y a la derecha modelo y enviar. Lo usan el chat nuevo y el hilo abierto.
 */
export function Composer({
	agent,
	blocked,
	file,
	fileError,
	fileInputRef,
	model,
	onClearFile,
	onFileChange,
	onSubmit,
	onTextChange,
	placeholder,
	text,
	autoFocus,
}: {
	agent: ComposerChoice | null;
	blocked: boolean;
	file: File | null;
	fileError: string | null;
	fileInputRef: RefObject<HTMLInputElement | null>;
	model: ComposerChoice;
	onClearFile: () => void;
	onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
	onSubmit: () => void;
	onTextChange: (text: string) => void;
	placeholder: string;
	text: string;
	autoFocus?: boolean;
}) {
	const canSend = canSendMessage({ text, hasFile: file !== null, blocked });

	return (
		<form
			className="w-full space-y-3 rounded-2xl border border-input bg-card p-4 shadow-xs"
			onSubmit={(event) => {
				event.preventDefault();
				if (canSend) onSubmit();
			}}
		>
			{file ? (
				<p className="flex items-center gap-2 text-muted-foreground text-sm">
					<FileIcon aria-hidden="true" className="size-4 shrink-0" />
					<span className="truncate">{file.name}</span>
					<button
						aria-label="Quitar archivo adjunto"
						className="text-muted-foreground hover:text-foreground"
						onClick={onClearFile}
						type="button"
					>
						<XIcon className="size-3.5" />
					</button>
				</p>
			) : null}
			{fileError ? (
				<p className="text-destructive text-sm" role="alert">
					{fileError}
				</p>
			) : null}
			<Textarea
				aria-label="Mensaje"
				autoFocus={autoFocus}
				className="max-h-60 min-h-14 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 md:text-base"
				disabled={blocked}
				onChange={(event) => onTextChange(event.target.value)}
				onKeyDown={(event) => {
					// Enter envía; Shift+Enter deja el salto de línea.
					if (
						event.key !== "Enter" ||
						event.shiftKey ||
						event.nativeEvent.isComposing
					)
						return;
					event.preventDefault();
					event.currentTarget.form?.requestSubmit();
				}}
				placeholder={placeholder}
				rows={2}
				value={text}
			/>
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<input
						className="sr-only"
						disabled={blocked}
						onChange={onFileChange}
						ref={fileInputRef}
						tabIndex={-1}
						type="file"
					/>
					<Button
						aria-label="Adjuntar archivo"
						disabled={blocked}
						onClick={() => fileInputRef.current?.click()}
						size="icon-sm"
						type="button"
						variant="outline"
					>
						<PlusIcon />
					</Button>
					{agent ? (
						<Choice
							choice={agent}
							icon
							label="Agente del chat"
							variant="muted"
						/>
					) : null}
				</div>
				<div className="flex min-w-0 items-center gap-2">
					<Choice choice={model} label="Modelo del chat" variant="ghost" />
					<Button
						aria-label="Enviar"
						className="rounded-full"
						disabled={!canSend}
						size="icon-sm"
						type="submit"
					>
						<ArrowUpIcon />
					</Button>
				</div>
			</div>
		</form>
	);
}
