// Lo que a propósito no se documenta en arquitectura/, dominios/ o guias/.
// Clave: "<superficie>:<key>" con superficie en tool · schedule · node ·
// workflow · table · route · provider · env. Valor: el motivo, de al menos diez
// caracteres. tests/docs/cobertura.test.ts falla si una entrada ya no existe
// en el disco. Nunca se agrega una entrada para poner un test en verde sin
// decidir: la salida normal es escribir la página.
export const SIN_DOCUMENTAR: Record<string, string> = {};
