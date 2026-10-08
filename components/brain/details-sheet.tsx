"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";

// Panel lateral con los datos de la página (spec 18.2 §4). Lo usan la lectura
// (solo datos) y el espacio de trabajo (datos y metadatos editables).
export function DetailsSheet({
	children,
	title = "Detalles",
}: {
	children: ReactNode;
	title?: string;
}) {
	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button variant="outline" className="min-h-11 lg:min-h-0">
					Detalles
				</Button>
			</SheetTrigger>
			<SheetContent side="right" className="w-[90vw] overflow-y-auto p-4">
				<SheetHeader className="p-0">
					<SheetTitle>{title}</SheetTitle>
					<SheetDescription className="sr-only">
						Datos de la página y sus conexiones.
					</SheetDescription>
				</SheetHeader>
				{children}
			</SheetContent>
		</Sheet>
	);
}
