"use client";

import { UserPlus } from "lucide-react";
import { InviteForm } from "@/app/[tenant]/settings/usuarios/invite-form";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

export function InviteDialog({ tenantId }: { tenantId: string; slug: string }) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button size="sm" type="button" variant="outline">
					<UserPlus aria-hidden className="size-4" />
					Invitá a un colaborador
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Invitá a un colaborador</DialogTitle>
				</DialogHeader>
				<InviteForm tenantId={tenantId} />
			</DialogContent>
		</Dialog>
	);
}
