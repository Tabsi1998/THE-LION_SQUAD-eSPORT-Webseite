import { API } from "@/lib/api";

// Die Statuten (#1252): wohin ein Link „Vereinsstatuten“ führt - auf genau die geltende Fassung (PDF), wenn sie
// öffentlich ist; sonst auf den Abschnitt „Statuten“ der Vorstandsseite, der sagt, wo sie stehen.

export function statutesHref(statutes) {
  const url = statutes?.available ? String(statutes.pdf_url || "") : "";
  if (url.startsWith("/api/")) return `${API}${url.slice(4)}`;
  if (/^https:\/\//.test(url)) return url;
  return "/board#statuten";
}
