import { useState } from "react";
import { Check, ImageIcon, Link2 } from "lucide-react";
import { toast } from "sonner";
import { resolveMediaUrl } from "@/lib/api";
import { copyResultLink } from "@/lib/resultShare";

// Rankingbanner (#2425, Nr. 60): ein Live-Bild mit Platz und Bilanz je Team und Season - der Link bleibt fest, das Bild zeichnet der
// Server bei jedem Abruf nach dem Stand der Tabelle (höchstens fünf Minuten zwischengespeichert). Nur öffentliche Seasons haben eines.

/** Die volle Adresse des Bildes - zum Einfügen in Discord oder ins Streaming-Programm. */
export function rankBannerLink(path, origin = typeof window === "undefined" ? "" : window.location.origin) {
  const url = resolveMediaUrl(path);
  try {
    return new URL(url, origin || undefined).href;
  } catch {
    return url;
  }
}

export function RankBannerCopy({ path, label = "Rankingbanner kopieren", nav = typeof navigator !== "undefined" ? navigator : null, testId = "rank-banner-copy",
  compact = false }) {
  const [copied, setCopied] = useState(false);
  if (!path) return null;
  const link = rankBannerLink(path);
  const copy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const result = await copyResultLink(link, nav);
    if (result.status === "copied") {
      setCopied(true);
      toast.success("Link zum Rankingbanner kopiert.");
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      toast.error("Kopieren ging nicht – öffne das Bild und kopiere die Adresse.");
    }
  };
  const Icon = copied ? Check : Link2;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid={testId}>
      <button type="button" onClick={copy} data-testid={`${testId}-button`} data-copied={copied ? "true" : undefined}
        className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-3 py-2 tls-type-label">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {copied ? "Kopiert" : label}
      </button>
      {compact ? null : (
        <a href={link} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-open`}
          className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center gap-2 rounded-sm px-3 py-2 tls-type-label">
          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" /> Bild öffnen
        </a>
      )}
    </span>
  );
}

/** Die Rankingbanner eines Teams (Teamseite): je Season Vorschau, Liga N und der Knopf zum Kopieren. */
export function TeamRankBanners({ rows, testId = "team-rank-banners" }) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  return (
    <section className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <div>
        <h2 id={`${testId}-title`} className="tls-type-label text-[#29B6E8]">Rankingbanner</h2>
        <p className="mt-1 tls-type-small text-white/55">Platz und Bilanz als Bild mit festem Link – für Discord oder den Stream. Es aktualisiert sich von selbst.</p>
      </div>
      <ul className="space-y-4">
        {list.map((row) => (
          <li key={row.key} className="space-y-2 min-w-0" data-testid={`${testId}-${row.key}`}>
            <p className="tls-type-small font-bold text-white/80 [overflow-wrap:anywhere]">
              {[row.league, row.season].filter(Boolean).join(" · ")}
              <span className="block font-normal text-white/50">{[row.name, row.division, row.staffel ? `Staffel ${row.staffel}` : ""].filter(Boolean).join(" · ")}</span>
            </p>
            <img src={rankBannerLink(row.image_url)} alt={`Rankingbanner ${row.name || ""} ${row.season || ""}`.trim()} loading="lazy" decoding="async"
              width="1200" height="300" className="block w-full h-auto rounded-sm border border-white/10 bg-black" />
            <RankBannerCopy path={row.image_url} testId={`${testId}-${row.key}-copy`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
