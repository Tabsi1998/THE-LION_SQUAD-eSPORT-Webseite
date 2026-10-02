import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { FindIcon } from "@/pages/user/profile/SeasonFindIcons";
import "@/pages/user/profile/season-finds.css";

// Saison-Fundstücke auf dem öffentlichen Profil (#678): nur wenn die Person den Schalter „Saison-Fundstücke
// öffentlich“ gesetzt hat (Vorgabe aus) - und dann nur die Summen je Saison und Fundstück, nie „heute“ oder ein
// Datum. Die Person selbst sieht die Karte immer, mit dem Hinweis, ob andere sie sehen.

function number(value) {
  return Number(value || 0).toLocaleString("de-DE");
}

export function PublicSeasonFinds({ userId, own = false }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!userId) return undefined;
    api.get(`/achievements/collectibles/user/${userId}`)
      .then(({ data: result }) => alive && setData(result || null))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [userId]);
  if (!data || data.hidden || !data.total) return null;
  return (
    <section className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="public-season-finds" data-public={data.public ? "1" : "0"}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Saison-Fundstücke</div>
          <h3 className="font-heading text-lg font-black uppercase mt-1">Über das Jahr gesammelt</h3>
        </div>
        <div className="text-right shrink-0">
          <div className="font-heading text-2xl font-black leading-none tabular-nums" data-testid="public-season-finds-total">{number(data.total)}</div>
          <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> insgesamt</div>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {data.seasons.map((season) => (
          <div key={season.key} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3" data-testid={`public-season-finds-${season.key}`}>
            <div className="font-heading font-bold uppercase text-sm tracking-wide px-1 pb-1.5">{season.label}</div>
            <ul className="space-y-0.5">
              {season.items.map((item) => (
                <li key={item.signal} className="tls-find" data-testid={`public-season-find-${item.signal}`}>
                  <FindIcon icon={item.icon} />
                  <span className="tls-find__count font-heading font-black text-xl leading-none">{number(item.count)}</span>
                  <span className="min-w-0 flex-1 text-sm text-white/80 leading-snug">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {own && (
        <p className="mt-3 text-[11px] text-white/40" data-testid="public-season-finds-note">
          {data.public ? "Andere sehen hier nur die Summen." : "Nur du siehst diese Karte. "}
          {!data.public && <Link to="/profile?tab=privacy" className="text-[#29B6E8] hover:underline">Unter Privatsphäre kannst du sie zeigen.</Link>}
        </p>
      )}
    </section>
  );
}
