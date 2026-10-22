"use client";

import { Sparkles, TriangleAlert, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { type LimitReason, limitMessage } from "@/lib/plans/limits";

const DEFAULT_CONTACT = "mailto:hola@innov.as?subject=Plan%20de%20Central%20IA";

export type LimitIconName = "users" | "sparkles" | "zap" | "triangle-alert";

export function limitIconName(reason: LimitReason): LimitIconName {
	switch (reason) {
		case "limit:users":
			return "users";
		case "limit:skills":
			return "sparkles";
		case "limit:ai_credit":
			return "zap";
		default:
			return "triangle-alert";
	}
}

const ICONS = {
	users: Users,
	sparkles: Sparkles,
	zap: Zap,
	"triangle-alert": TriangleAlert,
} as const;

/** Contenido del diálogo, separado para poder renderizarlo sin el portal. */
export function LimitDialogBody({
	reason,
	contactHref,
	onClose,
}: {
	reason: LimitReason;
	contactHref?: string;
	onClose: () => void;
}) {
	const { title, body } = limitMessage(reason);
	const Icon = ICONS[limitIconName(reason)];
	return (
		<>
			<DialogHeader>
				<Icon aria-hidden className="size-5 text-muted-foreground" />
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{body}</DialogDescription>
			</DialogHeader>
			<DialogFooter>
				<Button onClick={onClose} type="button" variant="outline">
					Ahora no
				</Button>
				<Button asChild>
					<a href={contactHref ?? DEFAULT_CONTACT}>Hablá con nosotros</a>
				</Button>
			</DialogFooter>
		</>
	);
}

export function LimitDialog({
	reason,
	open,
	onOpenChange,
	contactHref,
}: {
	reason: LimitReason;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	contactHref?: string;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<LimitDialogBody
					contactHref={contactHref}
					onClose={() => onOpenChange(false)}
					reason={reason}
				/>
			</DialogContent>
		</Dialog>
	);
}
