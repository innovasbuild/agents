import Link from "next/link";
import type { ReactNode } from "react";

// Sin gate acá: un layout no se vuelve a ejecutar en cada navegación. Cada
// página de la consola llama a requirePlatformAdmin().
export default function PlataformaLayout({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
				<div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 md:px-6">
					<Link
						href="/plataforma"
						className="min-w-0 flex-1 truncate font-semibold tracking-display"
					>
						Plataforma
					</Link>
					<Link
						href="/"
						className="inline-flex min-h-11 shrink-0 items-center text-muted-foreground text-sm hover:text-foreground"
					>
						Volver a los clientes
					</Link>
				</div>
			</header>
			<main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
				{children}
			</main>
		</div>
	);
}
