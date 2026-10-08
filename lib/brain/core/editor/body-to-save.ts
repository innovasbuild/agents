// Qué cuerpo se guarda (spec 18.2 V6). El editor visual lee el markdown y lo
// vuelve a escribir, y a veces lo normaliza. Si lo que serializa ahora es lo
// mismo que serializaba el cuerpo original al cargarlo, la persona no cambió
// nada y se guarda el original tal cual.
export function chooseBodyToSave(input: {
	original: string;
	originalRoundtrip: string;
	serialized: string;
}): string {
	return input.serialized === input.originalRoundtrip
		? input.original
		: input.serialized;
}
