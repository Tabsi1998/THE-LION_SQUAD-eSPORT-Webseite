import { httpsLink } from "./referenceOriginals";
import { partnerPath, type PartnerBadge } from "./seriesPartners";

// „Daten von …“ im Kopf einer Saison (#1964), wie im Web (components/tls/series/SeriesDataSource.jsx): Holt die Saison
// ihre Turniertage von der Plattform eines Partners, nennt der Kopf die Quelle - mit gewähltem Partner seine Seite im
// Web (#1934), sonst die Plattform selbst (nur https). Ein älterer Server schickt `data_source` nicht - dann kein Hinweis.

export type DataSource = { provider?: string | null; url?: string | null; partner?: PartnerBadge | null } | null | undefined;

export type DataSourceHint = { name: string; kind: "partner" | "platform" | "text"; target: string };

/** Name und Ziel des Hinweises - `null` ohne Quelle. Ziel: Pfad der Partnerseite im Web, https-Adresse der Plattform
 * oder leer (dann steht der Name ohne Link da). */
export function dataSourceHint(source: DataSource): DataSourceHint | null {
  if (!source || typeof source !== "object") return null;
  const partner = source.partner?.name ? source.partner : null;
  if (partner) {
    const path = partnerPath(partner);
    return { name: String(partner.name), kind: path ? "partner" : "text", target: path };
  }
  const provider = String(source.provider || "").trim();
  if (!provider) return null;
  const url = httpsLink(source.url);
  return { name: provider, kind: url ? "platform" : "text", target: url };
}
