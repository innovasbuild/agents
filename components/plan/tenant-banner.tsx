import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
	limitMessage,
	type Plan,
	type SuspendedReason,
	trialWarning,
} from "@/lib/plans/limits";

const CONTACT = "mailto:hola@innov.as?subject=Plan%20de%20Central%20IA";

export interface TenantBannerProps {
	plan: Plan;
	suspendedReason: SuspendedReason | null;
	trialEndsAt: string | null;
	isAdmin: boolean;
	slug: string;
	now?: Date;
}

export type Banner =
	| { kind: "suspended"; title: string; body: string; contactHref?: string }
	| { kind: "trial"; text: string; planHref?: string };

function formatDay(iso: string): string {
	return new Intl.DateTimeFormat("es-AR", {
		day: "numeric",
		month: "long",
		timeZone: "UTC",
	}).format(new Date(iso));
}

export function bannerFor(props: TenantBannerProps): Banner | null {
	if (props.suspendedReason) {
		const { title, body } = limitMessage(`suspended:${props.suspendedReason}`);
		return {
			kind: "suspended",
			title,
			body,
			...(props.isAdmin ? { contactHref: CONTACT } : {}),
		};
	}
	if (props.plan === "free" && props.trialEndsAt) {
		const warning = trialWarning(
			{
				plan: props.plan,
				suspendedReason: null,
				trialEndsAt: props.trialEndsAt,
				aiMonthlyLimitUsd: null,
			},
			props.now ?? new Date(),
		);
		if (warning) {
			return {
				kind: "trial",
				text: `El plan gratis termina el ${formatDay(props.trialEndsAt)}. Cargá una tarjeta antes para que el equipo no pierda el acceso a escribir.`,
				...(props.isAdmin ? { planHref: `/${props.slug}/settings/plan` } : {}),
			};
		}
	}
	return null;
}

export function TenantBanner(props: TenantBannerProps) {
	const banner = bannerFor(props);
	if (!banner) return null;
	const tone =
		banner.kind === "suspended"
			? "border-warn/40 bg-warn/15"
			: "bg-muted text-muted-foreground";
	return (
		<div className={`border-b ${tone}`} role="status">
			<div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3 px-4 py-2 text-sm md:px-6">
				<p className="min-w-0 flex-1">
					{banner.kind === "suspended" ? (
						<>
							<strong className="font-medium">{banner.title}.</strong>{" "}
							{banner.body}
						</>
					) : (
						banner.text
					)}
				</p>
				{banner.kind === "suspended" && banner.contactHref ? (
					<Button asChild size="sm" variant="outline">
						<a href={banner.contactHref}>Hablá con nosotros</a>
					</Button>
				) : null}
				{banner.kind === "trial" && banner.planHref ? (
					<Button asChild size="sm" variant="outline">
						<Link href={banner.planHref}>Ver mi plan</Link>
					</Button>
				) : null}
			</div>
		</div>
	);
}
