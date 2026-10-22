"use client";

import { LogOutIcon, ShieldIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { userInitials } from "@/lib/auth/user-initials";
import { signOut } from "./session-actions";

/**
 * El menú de la persona, arriba a la derecha. Muestra quién es y con qué
 * rol, la entrada a la consola de plataforma (solo platform_admin) y el
 * cierre de sesión.
 */
export function UserMenu({
	slug,
	email,
	roleLabel,
	isPlatformAdmin,
}: {
	slug: string;
	email: string | undefined;
	roleLabel: string;
	isPlatformAdmin: boolean;
}) {
	const [pending, startTransition] = useTransition();
	const initials = userInitials(email);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Menú de usuario"
				className="inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span className="inline-flex size-8 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground">
					{initials ?? <UserIcon aria-hidden className="size-4" />}
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-56">
				<DropdownMenuLabel className="font-normal">
					{email ? (
						<span className="block truncate text-sm">{email}</span>
					) : null}
					<span className="block text-muted-foreground text-xs">
						{roleLabel}
					</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{isPlatformAdmin ? (
					<>
						<DropdownMenuItem asChild className="py-2">
							<Link href="/plataforma">
								<ShieldIcon aria-hidden />
								Administrar la Plataforma
							</Link>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				) : null}
				<DropdownMenuItem
					className="py-2"
					disabled={pending}
					onSelect={(event) => {
						// Sin esto el menú se cierra antes de que la acción redirija.
						event.preventDefault();
						startTransition(() => signOut(slug));
					}}
				>
					<LogOutIcon aria-hidden />
					{pending ? "Cerrando sesión…" : "Cerrar sesión"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
