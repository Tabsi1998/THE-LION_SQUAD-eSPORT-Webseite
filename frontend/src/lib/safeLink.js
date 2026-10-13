// Links aus Eingaben (z. B. Nachweis-Links bei Fast-Lap-Zeiten, #1038) nur als http(s) mit Host rendern - alles andere
// (javascript:, data:, Steuerzeichen, kaputte Adressen) ergibt "" und damit keinen Link.
export function safeHttpUrl(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  // eslint-disable-next-line no-control-regex -- Steuerzeichen abzulehnen ist hier der Zweck
  if (!text || /[\s\\\u0000-\u001f]/.test(text)) return "";
  try {
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url.href : "";
  } catch {
    return "";
  }
}
