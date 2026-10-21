import { KIND_LABELS } from "./seriesFormat";

// Partner an Serien und Ligen in der App (#1934, #1974), wie im Web (frontend/src/lib/seriesPartners.js,
// components/tls/series/SeriesPartners.jsx, references/PartnerHostBadge.jsx, PartnerSeries.jsx): „Veranstaltet von“ mit
// Logo im Kopf einer Saison, ein kleines Partner-Abzeichen an laufenden Saisons und Spuren, und auf der Partnerkarte
// „Ligen und Serien mit uns“. Ältere Server schicken keine Partner - dann bleibt alles weg.

export type PartnerBadge = { id?: string | null; slug?: string | null; name?: string | null; logo_url?: string | null; kind?: string | null; role?: string | null };
export type SeasonPartners = { organizers?: PartnerBadge[] | null; contributors?: PartnerBadge[] | null } | null | undefined;

const named = (list: PartnerBadge[] | null | undefined) => (Array.isArray(list) ? list : []).filter((partner) => partner?.name);

/** Kopf einer Saison: wer veranstaltet (mit Logo) und wer mitwirkt - nur Partner mit Namen. */
export function partnerHead(partners: SeasonPartners): { organizers: PartnerBadge[]; contributors: PartnerBadge[] } {
  return { organizers: named(partners?.organizers), contributors: named(partners?.contributors) };
}

/** Der Veranstalter als kleines Abzeichen (laufende Saison, Spur) - der erste mit Namen, sonst nichts. */
export function hostBadge(organizers: PartnerBadge[] | null | undefined): PartnerBadge | null {
  return named(organizers)[0] || null;
}

/** Adresse der Partnerseite im Web. */
export function partnerPath(partner: PartnerBadge | null | undefined): string {
  const key = partner?.slug || partner?.id;
  return key ? `/partners/${encodeURIComponent(String(key))}` : "";
}

type LineageLike = {
  lineage?: { title?: string | null; slug?: string | null; kind?: string | null; game_name?: string | null; organizers?: PartnerBadge[] | null } | null;
  seasons?: Array<{ season?: string | null; tier?: string | null; title?: string | null; season_slug?: string | null; status?: string | null; club?: { rank?: number | null; of?: number | null } | null; organizers?: PartnerBadge[] | null }> | null;
};

const samePartner = (partner: PartnerBadge | null | undefined, id: string, slug: string) => Boolean(partner && ((id && partner.id === id) || (slug && partner.slug === slug)));

export type PartnerSeason = { key: string; eyebrow: string; title: string; season: string; running: boolean; club: string; target: { lineage: string; season: string } | null };

function seasonName(season: { title?: string | null; season?: string | null; tier?: string | null }): string {
  return [season.title, season.season, season.tier].filter(Boolean).join(" · ");
}

/** „Stand: 3. von 12“ (läuft) bzw. „Endplatz 3. von 12“, ohne Stand „Noch offen“ (läuft) oder leer. */
export function clubText(season: { club?: { rank?: number | null; of?: number | null } | null }, running: boolean): string {
  const rank = season.club?.rank;
  if (!rank) return running ? "Noch offen" : "";
  const of = season.club?.of ? ` von ${season.club.of}` : "";
  return running ? `Stand: ${rank}.${of}` : `Endplatz ${rank}.${of}`;
}

/** „Ligen und Serien mit uns“ auf der Partnerkarte: je Spur, die dieser Partner veranstaltet, die neueste Saison mit
 * ihm - aus /reference-series/public/lineages (dort stehen die Veranstalter; Mitwirkende zeigt die Partnerseite im Web).
 * Laufende zuerst, dann nach Titel. */
export function partnerSeries(partner: { id?: string | null; slug?: string | null; name?: string | null } | null | undefined, lineages: LineageLike[] | null | undefined): PartnerSeason[] {
  const id = String(partner?.id || "");
  const slug = String(partner?.slug || "");
  if (!id && !slug) return [];
  const out: PartnerSeason[] = [];
  for (const item of lineages || []) {
    const lineage = item?.lineage;
    if (!lineage?.slug) continue;
    const onLineage = (lineage.organizers || []).some((badge) => samePartner(badge, id, slug));
    const seasons = (item.seasons || []).filter((season) => season?.season_slug && (onLineage || (season.organizers || []).some((badge) => samePartner(badge, id, slug))));
    if (!seasons.length) continue;
    const latest = seasons.find((season) => season.status === "active") || seasons[seasons.length - 1];
    const running = latest.status === "active";
    out.push({
      key: lineage.slug,
      eyebrow: [`Veranstalter: ${partner?.name || "Partner"}`, KIND_LABELS[String(lineage.kind)], lineage.game_name].filter(Boolean).join(" · "),
      title: lineage.title || "",
      season: seasonName(latest),
      running,
      club: clubText(latest, running),
      target: latest.season_slug ? { lineage: lineage.slug, season: latest.season_slug } : null,
    });
  }
  return out.sort((a, b) => Number(b.running) - Number(a.running) || a.title.localeCompare(b.title, "de"));
}
