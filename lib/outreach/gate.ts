// Gate de estilo determinístico (spec 03 D3, §5.2). Porta la base genérica de
// scripts/gate.py v1.2.0 del canon; lo propio del tenant o del ejecutor entra
// como GateRules. fail e indeterminate bloquean, igual que los códigos 1 y 2.
import { compileVeto, type GateRules } from "./gate-blocks";
import { normalizeText } from "./text";

export const GATE_IDIOMAS = ["es_ar", "es_es"] as const;

export type GateStatus = "ok" | "fail" | "indeterminate";
export type GatePiece = "asunto" | "cuerpo";

export interface GateViolation {
	kind: "simbolo" | "formula" | "idioma" | "largo" | "formato" | "veto";
	piece: GatePiece;
	what: string;
	fix: string;
}

export interface GateWarning {
	piece: GatePiece;
	what: string;
	fix: string;
}

export interface GateResult {
	status: GateStatus;
	violations: GateViolation[];
	warnings: GateWarning[];
	notes: string[];
}

export interface GateInput {
	subject: string;
	body: string;
	channel: string;
	idioma: string;
	rules: GateRules;
}

interface SymbolRule {
	what: string;
	pattern: RegExp;
	fix: string;
	opening?: true;
}

const SYMBOLS: SymbolRule[] = [
	{
		what: "guion largo (em dash)",
		pattern: /—/g,
		fix: 'coma, punto, o "y" / "de"',
	},
	{
		what: "guion medio (en dash)",
		pattern: /–/g,
		fix: '"a" en rangos: 50 a 500 empleados',
	},
	{
		what: "signo de aproximación",
		pattern: /≈/g,
		fix: '"cerca de", "alrededor de"',
	},
	{ what: "tilde de aproximación", pattern: /~\s*\d/g, fix: '"cerca de 50"' },
	{ what: "bullet en texto corrido", pattern: /•/g, fix: "punto y aparte" },
	{
		what: "comilla tipográfica doble",
		pattern: /[“”]/g,
		fix: "comillas rectas, o ninguna",
	},
	{
		what: "comilla tipográfica simple",
		pattern: /[‘’]/g,
		fix: "apóstrofo recto, o ninguno",
	},
	{
		what: "puntos suspensivos de un solo carácter",
		pattern: /…/g,
		fix: "tres puntos, o terminar la frase",
	},
	{ what: "espacio duro", pattern: / /g, fix: "espacio normal" },
	{
		what: "signo de apertura de pregunta",
		pattern: /¿/g,
		fix: "solo el de cierre: por dónde arranco?",
		opening: true,
	},
	{
		what: "signo de apertura de exclamación",
		pattern: /¡/g,
		fix: "solo el de cierre: qué barbaridad!",
		opening: true,
	},
	{
		what: "emoji o pictograma",
		pattern:
			/(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}]|\u{FE0F})/gu,
		fix: "borrarlo",
	},
];

// Sobre texto normalizado. Las fórmulas de BM, BID y FAO de gate.py no están:
// son del tenant innovas y van a su página canon:gate.
const FORMULAS: Array<{ pattern: RegExp; fix: string }> = [
	{
		pattern: /espero que (te encuentres|estes|andes) (muy )?bien/g,
		fix: "arrancar por el dolor del que lee",
	},
	{
		pattern: /queria contarte/g,
		fix: "arrancar por el que lee, no por el que escribe",
	},
	{ pattern: /me permito/g, fix: "decir la cosa directamente" },
	{
		pattern: /revolucionar|transformacion total|reinventar/g,
		fix: "una promesa sostenible y concreta",
	},
	{
		pattern: /soluciones de inteligencia artificial/g,
		fix: "el problema concreto de su operación",
	},
	{
		pattern: /sinergia|ecosistema|holistic|disruptiv/g,
		fix: "la palabra común",
	},
	{
		pattern: /no dudes en (escribirme|contactarme|consultarme)/g,
		fix: "un ask con fecha",
	},
	{
		pattern: /quedo (a disposicion|atento|atenta|a tu disposicion)/g,
		fix: "un ask con fecha",
	},
	{ pattern: /alguna novedad/g, fix: "un dato nuevo: un caso, un benchmark" },
	{
		pattern:
			/te reitero|reiterando mi (mensaje|correo)|siguiendo mi mensaje anterior/g,
		fix: "un ángulo distinto sobre el mismo dolor",
	},
	{
		pattern: /somos una empresa lider|lideres en el (mercado|sector)/g,
		fix: "un hecho verificable, o nada",
	},
	{
		pattern: /en (el|un) mundo (actual|cada vez mas)/g,
		fix: "borrar la línea entera",
	},
	{ pattern: /en la era de/g, fix: "borrar la línea entera" },
	{
		pattern: /no solo[^.]{0,60}sino (que )?tambien/g,
		fix: "una sola afirmación",
	},
	{
		pattern: /vale la pena destacar|cabe destacar|es importante destacar/g,
		fix: "destacarlo, sin anunciar que se destaca",
	},
	{
		pattern: /en resumen,|en conclusion,/g,
		fix: "borrar: el mensaje es corto, no necesita resumen",
	},
	{ pattern: /potenciar|empoderar|apalancar/g, fix: "el verbo concreto" },
	{
		pattern: /soluciones a medida|llave en mano/g,
		fix: "qué hace, en una frase",
	},
	{
		pattern:
			/una breve (llamada|charla)|charla para conocernos|conocernos mejor/g,
		fix: "el ask real del canon del tenant",
	},
	{
		pattern: /te mando (info|informacion)|te comparto material/g,
		fix: "un ask con fecha",
	},
	{
		pattern: /espero tu respuesta|aguardo tu respuesta/g,
		fix: "un ask con fecha",
	},
	// Muletillas de validación del skill innovas-outreach-message que gate.py no tenía.
	{
		pattern:
			/justo lo que|es exactamente lo que|no es casualidad que|en un mundo donde|lo que realmente importa/g,
		fix: "decir el hecho sin validarlo",
	},
	// Recitar la investigación: el mensaje se escribe como quien ya conoce el negocio.
	{
		pattern:
			/\bvi que\b|\blei (en|que)\b|segun (su|tu) (sitio|web|pagina)|\bnote que\b|me llamo la atencion|estuve (viendo|mirando|leyendo)|investigando (sobre|a)\b/g,
		fix: "decir el hecho al pasar, sin contar que lo investigamos",
	},
];

const AFFIRMATIVE: Array<{ pattern: RegExp; fix: string }> = [
	{ pattern: /no es (un|una|el|la)\b/g, fix: "describir lo que la cosa es" },
	{ pattern: /no se trata de/g, fix: "describir lo que la cosa es" },
	{ pattern: /\ben vez de\b/g, fix: "afirmar sin el contraste" },
	{ pattern: /\ben meses, no en\b/g, fix: "afirmar el plazo solo" },
];

const MARKERS_ES =
	/\b(que|de|la|el|los|las|para|con|una|por|como|pero|cuando|donde|entre|sobre|sin|mas|ya|hay|su|del)\b/g;
const MARKERS_EN =
	/\b(the|and|of|to|for|with|that|this|your|we|our|is|are|from|about|would|have)\b/g;
const MARKERS_AR =
	/\b(vos|sos|tenes|podes|queres|sabes|haces|conta(me|rme)|deci(me|rme)|escribi(me|rme)|mira|fijate|aca|alla|charlamos|dale|laburo)\b/g;
const MARKERS_ES_ES =
	/\b(vosotros|teneis|podeis|quereis|tu tienes|tu puedes|puedes|tienes|quieres|aqui|os |contadme|coger|ordenador|movil)\b|(?:^|[,.;:]\s*)vale(?=[,.!]|\s+(?:entonces|pues|si|no)\b)/g;
const MARKER_THRESHOLD = 4;
const SUBJECT_MAX = 50;
const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/gi;
const TRACKING = /[?&](utm_[a-z]+|mc_eid|mc_cid|fbclid|gclid)=/gi;
// Redirecciones conocidas de plataformas de mailing/acortadores (spec 03 §5.2:
// "URLs con parámetros de tracking (utm_, mc_eid, redirecciones conocidas)").
const TRACKING_HOSTS =
	/\bhttps?:\/\/(?:[a-z0-9-]+\.)*(?:hubspotlinks\.com|hs-analytics\.net|list-manage\.com|mailchi\.mp|sendgrid\.net|mandrillapp\.com|bit\.ly|lnkd\.in|t\.co|tinyurl\.com|ow\.ly)\b/i;

function count(text: string, pattern: RegExp): number {
	return (text.match(pattern) ?? []).length;
}

function checkPiece(
	text: string,
	piece: GatePiece,
	rules: GateRules,
	vetos: Array<{ source: string; pattern: RegExp }>,
): GateViolation[] {
	const out: GateViolation[] = [];
	for (const rule of SYMBOLS) {
		if (rule.opening && rules.formal) continue;
		const matches = [...text.matchAll(rule.pattern)];
		for (const _match of matches) {
			out.push({ kind: "simbolo", piece, what: rule.what, fix: rule.fix });
		}
	}
	const plain = normalizeText(text);
	for (const rule of FORMULAS) {
		for (const match of plain.matchAll(rule.pattern)) {
			out.push({
				kind: "formula",
				piece,
				what: `fórmula vetada: "${match[0]}"`,
				fix: rule.fix,
			});
		}
	}
	if (text.match(HTML_TAG)) {
		out.push({
			kind: "formato",
			piece,
			what: "etiquetas HTML en un mensaje de texto plano",
			fix: "texto plano, sin formato",
		});
	}
	if (text.match(TRACKING)) {
		out.push({
			kind: "formato",
			piece,
			what: "link con parámetros de tracking",
			fix: "sacar los parámetros o el link",
		});
	}
	if (text.match(TRACKING_HOSTS)) {
		out.push({
			kind: "formato",
			piece,
			what: "link con redirección de tracking",
			fix: "link directo o ninguno",
		});
	}
	for (const veto of vetos) {
		for (const match of plain.matchAll(veto.pattern)) {
			out.push({
				kind: "veto",
				piece,
				what: `veto de ${veto.source}: "${match[0]}"`,
				fix: `ver la regla en ${veto.source}`,
			});
		}
	}
	return out;
}

function checkLanguage(
	body: string,
	idioma: string,
): { violations: GateViolation[]; indeterminate: string | null } {
	if (!(GATE_IDIOMAS as readonly string[]).includes(idioma)) {
		return {
			violations: [],
			indeterminate: `idioma "${idioma}" no soportado por el gate (solo es_ar y es_es)`,
		};
	}
	const plain = normalizeText(body);
	const es = count(plain, MARKERS_ES);
	const en = count(plain, MARKERS_EN);
	if (es + en < MARKER_THRESHOLD) {
		return {
			violations: [],
			indeterminate: `señal de idioma demasiado débil (${es + en} marcadores, umbral ${MARKER_THRESHOLD}): el gate no adivina`,
		};
	}
	if (en >= es) {
		return {
			violations: [
				{
					kind: "idioma",
					piece: "cuerpo",
					what: `el destinatario es ${idioma} y el texto parece inglés (es=${es}, en=${en})`,
					fix: "reescribir en el idioma del destinatario",
				},
			],
			indeterminate: null,
		};
	}
	const isAr = idioma === "es_ar";
	const pattern = isAr ? MARKERS_ES_ES : MARKERS_AR;
	const label = isAr
		? "forma peninsular en un mensaje es_ar"
		: "voseo en un mensaje es_es";
	const fix = isAr ? "usar la forma rioplatense" : "usar la forma peninsular";
	return {
		violations: [...plain.matchAll(pattern)].map((match) => ({
			kind: "idioma" as const,
			piece: "cuerpo" as const,
			what: `${label}: "${match[0].replace(/^[,.;:\s]+/, "").trim()}"`,
			fix,
		})),
		indeterminate: null,
	};
}

function checkLength(
	subject: string,
	body: string,
	channel: string,
	rules: GateRules,
): GateViolation[] {
	const out: GateViolation[] = [];
	const subjectLength = [...subject].length;
	if (subjectLength > SUBJECT_MAX) {
		out.push({
			kind: "largo",
			piece: "asunto",
			what: `${subjectLength} caracteres, el máximo es ${SUBJECT_MAX}`,
			fix: "el asunto nombra el dolor, no el producto",
		});
	}
	const limits = [rules.maxChars.all, rules.maxChars.byChannel[channel]].filter(
		(limit): limit is number => typeof limit === "number",
	);
	const bodyLength = [...body].length;
	if (limits.length > 0 && bodyLength > Math.min(...limits)) {
		out.push({
			kind: "largo",
			piece: "cuerpo",
			what: `${bodyLength} caracteres, el máximo propio es ${Math.min(...limits)}`,
			fix: "recortar",
		});
	}
	return out;
}

export function runGate(input: GateInput): GateResult {
	const subject = input.subject.trim();
	const body = input.body.trim();
	const violations: GateViolation[] = [];
	const notes: string[] = [];

	if (!subject)
		violations.push({
			kind: "formato",
			piece: "asunto",
			what: "asunto vacío",
			fix: "un asunto que nombre el dolor",
		});
	if (!body)
		violations.push({
			kind: "formato",
			piece: "cuerpo",
			what: "cuerpo vacío",
			fix: "redactar la pieza",
		});
	if (/[\r\n]/.test(input.subject))
		violations.push({
			kind: "formato",
			piece: "asunto",
			what: "salto de línea en el asunto",
			fix: "asunto en una sola línea",
		});

	const vetos: Array<{ source: string; pattern: RegExp }> = [];
	for (const veto of input.rules.vetos) {
		const pattern = compileVeto(veto);
		if (pattern) {
			vetos.push({ source: veto.source, pattern });
		} else {
			violations.push({
				kind: "veto",
				piece: "cuerpo",
				what: `veto mal formado en ${veto.source}: "${veto.phrase}"`,
				fix: "corregir la directiva en la página del brain",
			});
		}
	}
	for (const error of input.rules.errors) {
		violations.push({
			kind: "veto",
			piece: "cuerpo",
			what: `regla del gate mal formada: ${error}`,
			fix: "corregir la directiva en la página del brain",
		});
	}

	// Símbolos/fórmulas/formato/vetos corren sobre el texto sin recortar: trim()
	// saca U+00A0 (espacio duro), y ese es justamente uno de los símbolos que el
	// gate tiene que poder marcar en el borde de la pieza (paridad con gate.py).
	violations.push(...checkPiece(input.subject, "asunto", input.rules, vetos));
	violations.push(...checkPiece(input.body, "cuerpo", input.rules, vetos));
	violations.push(...checkLength(subject, body, input.channel, input.rules));

	const warnings: GateWarning[] = [];
	const plainBody = normalizeText(body);
	for (const rule of AFFIRMATIVE) {
		for (const match of plainBody.matchAll(rule.pattern)) {
			warnings.push({
				piece: "cuerpo",
				what: `construcción por negación: "${match[0]}"`,
				fix: rule.fix,
			});
		}
	}

	const language = checkLanguage(body, input.idioma);
	violations.push(...language.violations);
	if (language.indeterminate) notes.push(language.indeterminate);

	const status: GateStatus =
		violations.length > 0
			? "fail"
			: language.indeterminate
				? "indeterminate"
				: "ok";
	return { status, violations, warnings, notes };
}

/** Resumen citable de un gate que no pasó: las violaciones o, si no hay, las notas. */
export function gateSummary(gate: GateResult): string {
	return gate.violations.map((v) => v.what).join("; ") || gate.notes.join("; ");
}
