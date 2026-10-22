"use client";

import type { AuthMethod } from "@/lib/tenants/auth-methods";

export const LOGIN_METHOD_OPTIONS: { value: AuthMethod; label: string }[] = [
	{ value: "microsoft", label: "Microsoft" },
	{ value: "google", label: "Google" },
	{ value: "email", label: "Correo con código" },
];

/** Casillas de formas de entrar; la de la sesión actual queda marcada y fija. */
export function LoginMethodsField({
	methods,
	currentMethod,
	onToggle,
	disabled = false,
}: {
	methods: AuthMethod[];
	/** Método con el que entró quien edita: no se puede sacar. */
	currentMethod: AuthMethod | null;
	onToggle: (value: AuthMethod, checked: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<>
			{LOGIN_METHOD_OPTIONS.map((o) => (
				<label className="flex items-center gap-2 text-sm" key={o.value}>
					<input
						checked={methods.includes(o.value)}
						disabled={disabled || o.value === currentMethod}
						onChange={(e) => onToggle(o.value, e.target.checked)}
						type="checkbox"
					/>
					{o.label}
					{o.value === currentMethod ? (
						<span className="text-muted-foreground text-xs">
							Es la que estás usando ahora.
						</span>
					) : null}
				</label>
			))}
		</>
	);
}
