// Estado de carga de cualquier pantalla del cliente. Sin esto, navegar a una
// pantalla dinámica deja la anterior congelada hasta que el servidor termina
// de renderizar la nueva, y se siente como un clic que no hizo nada.
export default function TenantLoading() {
	return (
		<div aria-busy="true" className="space-y-4" role="status">
			<span className="sr-only">Cargando…</span>
			<div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
			<div className="h-4 w-full max-w-md animate-pulse rounded-md bg-muted" />
			<div className="h-40 w-full animate-pulse rounded-lg bg-muted" />
		</div>
	);
}
