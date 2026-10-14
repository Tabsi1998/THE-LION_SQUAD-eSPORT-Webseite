// Kennungen aus Adressen, Benachrichtigungen und Inhalten auf dem Weg in einen API-Pfad (#1000) - an einer Stelle.
// Eine Kennung kommt roh („löwen-cup“) oder schon kodiert aus einer Adresse („l%C3%B6wen-cup“). Sie wird einmal
// dekodiert (eine kaputte Kodierung bleibt, wie sie ist), dann geprüft und für genau einen Pfadteil kodiert. So wird
// aus „..%2Fadmin“ nie ein Abruf auf /admin - eine Kennung mit Pfadzeichen ist keine.

/** Die Kennung taugt nicht für einen Pfadteil - für den Screen: „nicht gefunden“. */
export class InvalidIdError extends Error {
  constructor(value: unknown) {
    super(`Ungültige Kennung: ${String(value).slice(0, 80)}`);
    this.name = "InvalidIdError";
  }
}

const MAX_LENGTH = 200;

function decodeOnce(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Ist das eine Kennung, die als ein Pfadteil in die API darf? Leer, „.“, „..“, „/“, „\“, „?“, „#“, Steuerzeichen und Überlänge nicht. */
export function isValidId(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const id = decodeOnce(String(value).trim());
  if (!id || id.length > MAX_LENGTH || id === "." || id === "..") return false;
  // eslint-disable-next-line no-control-regex
  return !/[/\\?#\u0000-\u001f\u007f]/.test(id);
}

/** Die Kennung als kodierter Pfadteil für `api.get(`/news/${idSegment(id)}`)` - wirft `InvalidIdError`, wenn sie keine ist. */
export function idSegment(value: unknown): string {
  if (!isValidId(value)) throw new InvalidIdError(value);
  return encodeURIComponent(decodeOnce(String(value).trim()));
}
