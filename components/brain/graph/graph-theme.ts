// Colores del grafo tomados de los tokens del tema (spec 26.4, D5). Los tokens
// pueden venir en oklch y Sigma solo entiende hex o rgb: se pintan en un canvas
// de 1×1 y se lee el píxel, que el navegador ya devuelve en sRGB.

export interface GraphTheme {
	palette: string[];
	edge: string;
	label: string;
	ghost: string;
	background: string;
}

const PALETTE_TOKENS = [
	"--chart-1",
	"--chart-2",
	"--chart-3",
	"--chart-4",
	"--chart-5",
];

let probe: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D | null {
	if (probe) return probe;
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	probe = canvas.getContext("2d", { willReadFrequently: true });
	return probe;
}

function resolve(value: string, fallback: string): string {
	const ctx = context();
	if (!ctx || value === "") return fallback;
	ctx.clearRect(0, 0, 1, 1);
	// Un valor que el canvas no entiende deja el anterior: se arranca del
	// fallback para no heredar el color del token previo.
	ctx.fillStyle = fallback;
	ctx.fillStyle = value;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	if (a === 255) return `rgb(${r}, ${g}, ${b})`;
	return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
}

// Lee los tokens donde se aplican (por defecto, <html>): si una empresa o una
// sección los pisa más abajo, quien llama pasa ese elemento.
export function readGraphTheme(
	from: Element = document.documentElement,
): GraphTheme {
	const style = getComputedStyle(from);
	const token = (name: string) => style.getPropertyValue(name).trim();
	return {
		palette: PALETTE_TOKENS.map((name) => resolve(token(name), "#808080")),
		edge: resolve(token("--border"), "#cccccc"),
		label: resolve(token("--foreground"), "#1c1c1c"),
		ghost: resolve(token("--destructive"), "#dc2626"),
		background: resolve(token("--background"), "#ffffff"),
	};
}

// Llama a `onChange` cada vez que cambia la clase `dark` de <html>. Devuelve la
// función que corta la observación.
export function watchColorScheme(onChange: () => void): () => void {
	const root = document.documentElement;
	let dark = root.classList.contains("dark");
	const observer = new MutationObserver(() => {
		const now = root.classList.contains("dark");
		if (now === dark) return;
		dark = now;
		onChange();
	});
	observer.observe(root, { attributes: true, attributeFilter: ["class"] });
	return () => observer.disconnect();
}
