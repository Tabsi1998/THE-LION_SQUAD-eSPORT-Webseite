import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { FindIcon } from "./SeasonFindIcons";
import "./season-finds.css";

// Saison-Fundstücke (#678): was du über die Jahreszeiten gesammelt hast - verscheuchte Fledermäuse, befreite Geister,
// gefangene Schneeflocken, Türchen, Eier. Was gerade läuft, steht groß und oben, mit dem Stand von heute und dem
// Tagesdeckel; die anderen Jahreszeiten darunter als kleine Karten mit ihrem nächsten Termin. Persönlich - die Karte
// gibt es nur im eigenen Profil. Meldet die Seite gerade ein neues Fundstück (tls:season-signal), lädt sie nach.

export const REFRESH_AFTER_SIGNAL_MS = 4000;

const DAY = { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit" };

export function dayText(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("de-AT", DAY);
}

/** Ein Satz zur Saison: läuft (bis wann), kommt (ab wann) - oder nichts, wenn es keinen Termin gibt. */
export function seasonHint(season) {
  if (season.active) return season.ends_at ? `läuft bis ${dayText(season.ends_at)}` : "läuft gerade";
  return season.next_start ? `ab ${dayText(season.next_start)}` : "";
}

/** Die laufenden Saisonen zuerst, dann die mit Fundstücken, dann der Rest - jeweils in der Reihenfolge des Jahres. */
export function orderSeasons(seasons = []) {
  const rank = (season) => (season.active ? 0 : season.count > 0 ? 1 : 2);
  return seasons.map((season, index) => ({ season, index })).sort((a, b) => rank(a.season) - rank(b.season) || a.index - b.index).map((row) => row.season);
}

function number(value) {
  return Number(value || 0).toLocaleString("de-DE");
}

function Find({ item, active }) {
  const empty = !item.count;
  const capped = active && item.per_day > 1;
  const percent = capped ? Math.max(0, Math.min(100, (item.today / item.per_day) * 100)) : 0;
  const full = capped && item.today >= item.per_day;
  return (
    <li className={`tls-find${empty ? " tls-find--empty" : ""}`} data-testid={`season-find-${item.signal}`}>
      <FindIcon icon={item.icon} />
      <span className="tls-find__count font-heading font-black text-xl leading-none">{number(item.count)}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-white/80 leading-snug">{item.label}</span>
        {capped ? (
          <span className="mt-1.5 flex items-center gap-2" title={full ? "Für heute ist alles gesammelt - morgen geht es weiter." : `Heute zählen noch ${number(item.per_day - item.today)}.`}>
            <span className={`tls-find__today flex-1${full ? " tls-find__today--full" : ""}`}><span style={{ width: `${percent}%` }} /></span>
            <span className="text-[10px] text-white/45 tabular-nums whitespace-nowrap" data-testid={`season-find-${item.signal}-today`}>heute {number(item.today)} von {number(item.per_day)}</span>
          </span>
        ) : (
          item.season_count > 0 && item.season_count !== item.count && <span className="block text-[10px] text-white/40">zuletzt {number(item.season_count)}</span>
        )}
      </span>
    </li>
  );
}

function Season({ season }) {
  return (
    <section
      className={`tls-finds__season border border-white/10 bg-[#0A0A0A] rounded-sm p-3${season.active ? " tls-finds__season--active" : ""}`}
      data-testid={`season-finds-${season.key}`}
      data-active={season.active ? "1" : "0"}
      aria-label={season.label}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 pt-1 pb-2">
        <span className="font-heading font-bold uppercase text-sm tracking-wide inline-flex items-center gap-2">
          {season.label}
          {season.active && <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-[#00FF88]/15 text-[#00FF88] tracking-wider">läuft</span>}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-white/40 whitespace-nowrap" data-testid={`season-finds-${season.key}-hint`}>{seasonHint(season)}</span>
      </header>
      <ul className={season.active && season.items.length > 1 ? "grid sm:grid-cols-2 gap-x-4 gap-y-0.5" : "space-y-0.5"}>
        {season.items.map((item) => <Find key={item.signal} item={item} active={season.active} />)}
      </ul>
    </section>
  );
}

export function SeasonFindsPanel() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/achievements/collectibles");
      setData(result && Array.isArray(result.seasons) ? result : { total: 0, seasons: [] });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
    let timer = 0;
    const onSignal = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, REFRESH_AFTER_SIGNAL_MS);
    };
    window.addEventListener("tls:season-signal", onSignal);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("tls:season-signal", onSignal);
    };
  }, [load]);

  if (!data) {
    return failed ? <div className="border border-white/10 bg-[#121212] rounded-sm p-5 text-xs text-white/45" data-testid="season-finds-error">Die Saison-Fundstücke konnten gerade nicht geladen werden.</div> : null;
  }
  const seasons = orderSeasons(data.seasons);
  const running = seasons.filter((season) => season.active);
  const others = seasons.filter((season) => !season.active);
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="season-finds">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Saison-Fundstücke</div>
          <h3 className="font-heading text-xl font-black uppercase mt-1">Was du über das Jahr gesammelt hast</h3>
        </div>
        <div className="text-right shrink-0">
          <div className="font-heading text-2xl font-black leading-none tabular-nums" data-testid="season-finds-total">{number(data.total)}</div>
          <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> insgesamt</div>
        </div>
      </div>
      {data.total === 0 && (
        <p className="mb-4 text-xs text-white/55 max-w-2xl" data-testid="season-finds-empty">
          Noch nichts gesammelt. In jeder Jahreszeit versteckt die Seite etwas zum Anklicken – Fledermäuse zu Halloween, die Schneeflocke neben dem Logo im Winter. Was du findest, zählt hier und für deine Erfolge.
        </p>
      )}
      {running.length > 0 && (
        <div className="space-y-3 mb-3" data-testid="season-finds-running">
          {running.map((season) => <Season key={season.key} season={season} />)}
        </div>
      )}
      {others.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3" data-testid="season-finds-others">
          {others.map((season) => <Season key={season.key} season={season} />)}
        </div>
      )}
      <p className="mt-4 text-[11px] text-white/35">Nur du siehst diese Karte. Je Tag zählt eine Höchstzahl – was darüber hinausgeht, ist Spaß an der Freude.</p>
    </div>
  );
}
