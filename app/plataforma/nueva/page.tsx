import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/tenants/platform";
import { CreateForm } from "./create-form";

export default async function NuevaEmpresaPage() {
	const admin = await requirePlatformAdmin();
	if (!admin) notFound();

	return (
		<div className="max-w-3xl space-y-6">
			<Link
				href="/plataforma"
				className="inline-flex min-h-11 items-center text-muted-foreground text-sm hover:text-foreground"
			>
				← Empresas
			</Link>
			<h1 className="text-3xl leading-tight">Nueva empresa</h1>
			<CreateForm />
		</div>
	);
}
