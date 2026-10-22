"use client";

import { ImageUpIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { validateLogo } from "@/lib/tenants/tenant-form";
import { skipLogoStep, uploadLogoStep } from "./actions";

export function LogoForm({
	slug,
	displayName,
}: {
	slug: string;
	displayName: string;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const [pending, startTransition] = useTransition();

	useEffect(() => {
		if (!file) {
			setPreview(null);
			return;
		}
		const url = URL.createObjectURL(file);
		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	function pick(next: File | undefined) {
		if (!next) return;
		const checked = validateLogo(next);
		if (!checked.ok) {
			setFile(null);
			setError(checked.message);
			return;
		}
		setError(null);
		setFile(next);
	}

	function submit() {
		if (!file) return;
		const formData = new FormData();
		formData.set("logo", file);
		startTransition(async () => {
			const result = await uploadLogoStep(slug, formData);
			if (!result.ok) setError(result.message);
		});
	}

	function skip() {
		startTransition(async () => {
			await skipLogoStep(slug);
		});
	}

	return (
		<div className="space-y-5">
			<div className="space-y-2">
				<h1 className="text-2xl leading-tight">Ponele tu logo</h1>
				<p className="text-muted-foreground text-sm">
					Aparece en la cabecera y en la pantalla de entrada de tu equipo. Lo
					podés cambiar cuando quieras.
				</p>
			</div>
			<button
				className={`flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors hover:bg-muted ${dragging ? "bg-muted" : ""}`}
				onClick={() => inputRef.current?.click()}
				onDragLeave={() => setDragging(false)}
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					pick(e.dataTransfer.files[0]);
				}}
				type="button"
			>
				<ImageUpIcon aria-hidden className="size-6 text-muted-foreground" />
				<span className="text-sm">
					{file ? file.name : "Arrastrá el logo o hacé clic para elegirlo"}
				</span>
				<span className="text-muted-foreground text-xs">
					PNG, SVG o WebP · hasta 1 MB
				</span>
			</button>
			<input
				accept="image/png,image/svg+xml,image/webp"
				className="hidden"
				onChange={(e) => pick(e.target.files?.[0])}
				ref={inputRef}
				type="file"
			/>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			<div className="flex items-center gap-3 rounded-lg border p-3">
				{preview ? (
					// biome-ignore lint/performance/noImgElement: vista previa local (blob:)
					<img
						alt=""
						className="size-10 rounded-md object-contain"
						height={40}
						src={preview}
						width={40}
					/>
				) : (
					<span
						aria-hidden
						className="flex size-10 items-center justify-center rounded-md bg-primary font-medium text-primary-foreground"
					>
						{displayName.trim().charAt(0).toUpperCase()}
					</span>
				)}
				<span className="font-medium text-sm">{displayName}</span>
			</div>
			<Button
				className="w-full"
				disabled={pending || !file}
				onClick={submit}
				size="lg"
				type="button"
			>
				Guardar y seguir
			</Button>
			<p className="text-center">
				<button
					className="text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground"
					disabled={pending}
					onClick={skip}
					type="button"
				>
					Lo dejo para después
				</button>
			</p>
		</div>
	);
}
