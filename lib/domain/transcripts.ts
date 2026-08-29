const LEGACY_TRANSCRIPTION_CONTEXT =
  "llamada logistica en espanol sobre tarifas mxn fechas horarios manzanillo guadalajara transportistas y confirmacion de recoleccion";

function normalizeTranscript(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isTranscriptionContextEcho(text: string) {
  return normalizeTranscript(text) === LEGACY_TRANSCRIPTION_CONTEXT;
}
