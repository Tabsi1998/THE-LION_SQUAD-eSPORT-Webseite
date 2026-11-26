// Automatische Hinweisbanner (#2352): die laufenden Banner unter Einstellungen → Banner und die Zahlen am Turnier bzw.
// an der Fast-Lap-Challenge. Nur lesbar; die Zahlen sind nicht öffentlich und kommen aus Admin-Endpunkten.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { autoBannerKindLabel, autoBannerNumbers, autoBannerPeriod, autoBannerTemplateLabel } from "@/lib/autoBanners";

export function AutoBannerList() {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get("/settings/site-banners/admin/auto")
      .then(({ data }) => { if (alive) setItems(Array.isArray(data?.items) ? data.items : []); })
      .catch(() => { if (alive) { setItems([]); setFailed(true); } });
    return () => { alive = false; };
  }, []);

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="auto-banner-list">
      <div className="tls-type-label text-white/65 mb-1">Automatische Banner</div>
      <p className="tls-type-small text-white/45 mb-3">Laufen von selbst an Turnier, Fast-Lap-Challenge oder Server. Geschaltet werden sie dort.</p>
      <div className="space-y-2">
        {(items || []).map((item) => (
          <div key={item.id} className="border border-white/10 bg-black/20 rounded-sm p-3" data-testid={`auto-banner-${item.id}`}>
            <div className="tls-type-label text-honor">
              {autoBannerKindLabel(item.kind)} · {autoBannerTemplateLabel(item.kind, item.template)}
            </div>
            <div className="font-bold tls-type-small break-words">{item.title || item.text}</div>
            {item.title && item.text && <div className="tls-type-small text-white/55 break-words">{item.text}</div>}
            <div className="tls-type-small text-white/45">{autoBannerPeriod(item)}</div>
            <div className="mt-1 tls-type-small text-white/45">{autoBannerNumbers(item.stats)}</div>
            {item.manage_url && (() => {
              const linkText = item.kind === "server" ? "Zu den Servern" : item.kind === "fastlap" ? "Zur Challenge" : "Zum Turnier";
              // Mehrere gleich lautende Links in der Liste: der Titel sagt dem Screenreader, wohin es geht.
              return (
                <Link to={item.manage_url} aria-label={item.title ? `${linkText} ${item.title}` : linkText} className="mt-1 inline-block tls-type-small font-bold text-[#29B6E8] hover:underline">
                  {linkText}
                </Link>
              );
            })()}
          </div>
        ))}
        {items && items.length === 0 && (
          <div className="tls-type-small text-quiet py-4 text-center">
            {failed ? "Automatische Banner konnten nicht geladen werden." : "Gerade läuft kein automatischer Banner."}
          </div>
        )}
      </div>
    </div>
  );
}

// Zahlen am Turnier bzw. an der Challenge - je Vorlage, auch wenn der Banner nicht mehr läuft. Ohne Zahlen nichts.
export function AutoBannerStats({ kind, refId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!refId) return undefined;
    let alive = true;
    api.get(`/settings/site-banners/admin/stats/${kind}/${encodeURIComponent(refId)}`)
      .then(({ data: body }) => { if (alive) setData(body); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [kind, refId]);

  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) return null;
  return (
    <div className="-mt-1 pl-5 tls-type-small text-white/50" data-testid={`auto-banner-stats-${kind}`}>
      <div>{autoBannerNumbers(data.total)}</div>
      {items.length > 1 && items.map((item) => (
        <div key={item.id} className="text-white/50">
          {autoBannerTemplateLabel(kind, item.template)}: {autoBannerNumbers({ impressions: item.stats?.impressions, clicks: item.stats?.clicks })}
        </div>
      ))}
    </div>
  );
}
