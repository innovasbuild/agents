import { Confirmar } from "./confirmar";

export default async function ConfirmarPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string }>;
}) {
	const { next } = await searchParams;

	return <Confirmar next={next ?? null} />;
}
