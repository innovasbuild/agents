import { cn } from "cn";
import type { ReactNode } from "react";

// Hoja de papel del brain (spec 18.2 §6). La usan la lectura y la edición.
export function Paper({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("brain-paper", className)}>{children}</div>;
}
