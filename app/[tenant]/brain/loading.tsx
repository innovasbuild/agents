// Carga dentro del shell del brain: al pasar de una página del wiki a otra el
// árbol lateral se queda y solo el contenido muestra el estado de carga. Sin
// este archivo entraría el de [tenant], que reemplazaría el shell entero.
export default function BrainLoading() {
	return (
		<div aria-busy="true" className="space-y-4" role="status">
			<span className="sr-only">Cargando…</span>
			<div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
			<div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
			<div className="h-4 w-1/2 animate-pulse rounded-md bg-muted" />
			<div className="h-48 w-full animate-pulse rounded-lg bg-muted" />
		</div>
	);
}
