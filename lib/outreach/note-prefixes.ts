// Prefijos que este código escribe en el `body` de una nota de HubSpot.
// Sync entrante de HubSpot (crm-sync.ts) los usa para no reimportar como
// "nota agregada a mano en HubSpot" algo que la propia app ya escribió ahí.
export const OUT_NOTE_PREFIX = "[out · ";
export const NOTA_NOTE_PREFIX = "[nota · ";
