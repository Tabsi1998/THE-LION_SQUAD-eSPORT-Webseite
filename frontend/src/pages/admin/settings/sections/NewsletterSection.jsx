// E-Mail → Newsletter (#1359): nur noch der Verlauf für System - welche News und Events wann an wie viele Personen gingen.
// Gesendet wird im Kasten „Verteilen“ im News- und Event-Editor. Keine Rohwerte, keine Empfänger.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { viennaDateTime } from "@/lib/vienna";

const KIND_LABELS = { news: "News", event: "Event" };
const VISIBILITY_LABELS = { public: "Öffentlich", community: "Angemeldete", members: "Nur Mitglieder", internal: "Nur intern" };

export function NewsletterSection() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get("/settings/newsletter/history")
      .then(({ data }) => { setItems(Array.isArray(data?.items) ? data.items : []); setError(""); })
      .catch((failure) => setError(formatRequestError(failure, "Der Verlauf lässt sich gerade nicht laden.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 tls-type-small text-white/70" data-testid="newsletter-intro">
        <div className="font-bold uppercase text-[#29B6E8] mb-1">Newsletter-Verlauf</div>
        <p>News und Events gehen beim Veröffentlichen von selbst an alle mit Newsletter-Zustimmung. Senden und ein zweites Mal senden geht im Kasten „Verteilen“ im <Link to="/admin/news" className="text-[#29B6E8] hover:underline">News-</Link> und <Link to="/admin/events" className="text-[#29B6E8] hover:underline">Event-Editor</Link>. Hier steht, was wann hinausging.</p>
      </div>
      {error && <div className="border border-[#FF3B30]/40 bg-[#FF3B30]/10 rounded-sm p-4 tls-type-small" data-testid="newsletter-history-error">{error}</div>}
      {items === null && !error && <div className="tls-type-small text-white/45" role="status">Lade Verlauf …</div>}
      {items && (
        <ul className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5" data-testid="newsletter-history">
          {items.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 tls-type-small" data-testid={`newsletter-history-${row.id}`}>
              <span className="tls-type-label px-2 py-0.5 rounded-sm border border-white/15 text-white/60">{KIND_LABELS[row.kind] || "Beitrag"}</span>
              <Link to={row.kind === "event" ? `/admin/events/${row.id}` : `/admin/news/${row.id}`} className="font-semibold hover:text-[#29B6E8] min-w-0 break-words">{row.title || "Ohne Titel"}</Link>
              <span className="text-white/55">{viennaDateTime(row.sent_at)} · an {row.sent_count === 1 ? "1 Person" : `${row.sent_count} Personen`}</span>
              <span className="text-white/45 tls-type-small">{VISIBILITY_LABELS[row.visibility] || "Öffentlich"}{row.sent_by ? ` · von Hand: ${row.sent_by}` : " · beim Veröffentlichen"}</span>
            </li>
          ))}
          {!items.length && <li className="px-4 py-10 text-center tls-type-small text-quiet">Noch kein Newsletter verschickt.</li>}
        </ul>
      )}
    </div>
  );
}
