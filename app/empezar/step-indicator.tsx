const LABELS = [
	"Tu empresa",
	"Las carpetas de tu brain",
	"Tu logo",
	"Quién entra",
	"Tu equipo",
];

/** "Paso N de 6" del onboarding (N de 2 a 6): 6 segmentos llenos hasta el actual. */
export function StepIndicator({ step }: { step: 2 | 3 | 4 | 5 | 6 }) {
	return (
		<div className="space-y-2">
			<div className="flex gap-1">
				{[1, 2, 3, 4, 5, 6].map((n) => (
					<span
						className={`h-1 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-border"}`}
						key={n}
					/>
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				Paso {step} de 6 · {LABELS[step - 2]}
			</p>
		</div>
	);
}
