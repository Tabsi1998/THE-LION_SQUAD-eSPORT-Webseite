import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock3, Gift, Lightbulb, LogIn, Trophy } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { EggShape } from "@/seasons/easterHunt/EggShape";
import { fetchHuntPage, onHuntProgress } from "@/seasons/easterHunt/api";
import "@/seasons/easterHunt/easter-hunt.css";

// Die Seite der Ostereiersuche (#646, Korb #758): der eigene Korb mit den gefundenen Eiern in ihrem echten Muster,
// leere Plätze für die fehlenden (ohne etwas zu verraten), Hinweise ab dem zweiten Tag, Preise, die Schnellsten
// und die Regeln. Gäste sehen alles außer einem Korb und werden zum Anmelden eingeladen.

const SERIF = { fontFamily: 'Georgia, "Noto Serif", "Times New Roman", serif' };

function dayLabel(iso) {
  const day = new Date(iso || "");
  if (Number.isNaN(day.getTime())) return "";
  return day.toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Vienna" });
}

function timeLabel(iso) {
  const day = new Date(iso || "");
  if (Number.isNaN(day.getTime())) return "";
  return day.toLocaleString("de-AT", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
}

/** „1 Std. 12 Min.“ - die Zeit bis zum vollen Korb, gezählt ab Karfreitag 0 Uhr. */
export function durationLabel(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? "Tag" : "Tage"}`);
  if (hours) parts.push(`${hours} Std.`);
  if (minutes || !parts.length) parts.push(`${minutes} Min.`);
  return parts.join(" ");
}

export function phaseText(page) {
  switch (page?.phase) {
    case "upcoming":
      return `Die Suche beginnt am ${dayLabel(page.starts_at)} um 0 Uhr.`;
    case "running":
      return `Die Eier sind versteckt – gesucht wird bis ${dayLabel(page.ends_at)}, 23:59 Uhr.`;
    case "ended":
      return "Die Suche ist vorbei – ausgewertet wird in Kürze.";
    case "drawn":
      return "Die Suche ist ausgewertet. Wer gewonnen hat, wurde benachrichtigt.";
    default:
      return page?.next_start ? `Die nächste Eiersuche beginnt am ${dayLabel(page.next_start)}.` : "Gerade ist keine Eiersuche geplant.";
  }
}

/** Der Korb: gefundene Eier mit Muster, leere Mulden für die fehlenden - nie mehr verraten als die Zahl. */
export function Basket({ me, total, reduced }) {
  const found = me?.eggs || [];
  const missing = Math.max(0, Number(total || 0) - found.length);
  return (
    <section className="rounded-sm border border-[#e9c46a]/30 bg-gradient-to-b from-[#1d1a12] to-[#0d0c09] p-5 sm:p-6" data-testid="easter-basket">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-2xl text-[#fff6e0]" style={SERIF}>Dein Korb</h2>
        <span className="text-sm font-bold text-[#e9c46a] tabular-nums" data-testid="easter-basket-count">{found.length} von {total}</span>
      </div>
      <ul className="mt-4 flex flex-wrap gap-3 list-none p-0" aria-label="Gefundene Eier">
        {found.map((egg, index) => (
          <li key={egg.egg_no} className={`tls-basket-egg${reduced ? "" : " tls-basket-egg--in"}`} style={{ animationDelay: `${Math.min(index, 12) * 70}ms` }} title={`Gefunden am ${timeLabel(egg.found_at)}`} data-testid={`easter-basket-egg-${egg.egg_no}`}>
            <EggShape pattern={egg.pattern} size={36} />
          </li>
        ))}
        {Array.from({ length: missing }, (_, index) => (
          <li key={`missing-${index}`} className="tls-basket-hole" aria-label="Noch nicht gefunden" data-testid="easter-basket-hole" />
        ))}
      </ul>
      {me?.completed_at ? (
        <p className="mt-4 text-[#ffd700] font-bold" data-testid="easter-basket-done">Korb voll – Platz {me.rank}! Du bist in der Verlosung.</p>
      ) : (
        <p className="mt-4 text-sm text-white/60">Die Eier liegen auf der Website und in der App – an Karten, Bildern, beim Löwen, oben und unten. Ein Klick sammelt ein.</p>
      )}
    </section>
  );
}

export function Hints({ me }) {
  if (!me?.active || me.completed_at) return null;
  return (
    <section className="rounded-sm border border-white/10 bg-[#111] p-5" data-testid="easter-hints">
      <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Lightbulb className="w-4 h-4 text-[#e9c46a]" /> Hinweise</h2>
      {me.hints_open ? (
        <ul className="mt-3 space-y-2 text-sm text-white/75">
          {me.hints.map((hint, index) => <li key={index} className="flex gap-2"><span className="text-[#e9c46a]">•</span>{hint.hint}{hint.channel === "app" ? <span className="text-white/40"> (App)</span> : null}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-white/60">Ab {dayLabel(me.hints_open_at)} gibt es zu jedem fehlenden Ei einen Hinweis.</p>
      )}
    </section>
  );
}

export default function EasterHuntPage() {
  useDocumentTitle("Ostereiersuche", "Ostereier auf der Website und in der App von THE LION SQUAD eSports finden – mit Verlosung und Preisen für die Schnellsten.");
  const { user } = useAuth();
  const reduced = useReducedMotion();
  const [page, setPage] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    fetchHuntPage().then((data) => { setPage(data); setFailed(false); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load, user?.id]);
  useEffect(() => onHuntProgress(() => load()), [load]);

  const total = page?.egg_count || 0;
  const running = page?.phase === "running";
  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-6" data-testid="easter-hunt-page">
        <header>
          <div className="text-[11px] font-bold uppercase tracking-[0.35em] text-[#e9c46a]">Ostern {page?.year || ""}</div>
          <h1 className="mt-2 text-4xl sm:text-5xl text-[#fff6e0]" style={SERIF} data-testid="easter-title">Ostereiersuche</h1>
          <p className="mt-3 flex items-center gap-2 text-white/70" data-testid="easter-phase"><Clock3 className="w-4 h-4 text-[#e9c46a] shrink-0" />{failed ? "Die Eiersuche lässt sich gerade nicht laden." : page ? phaseText(page) : "Wird geladen …"}</p>
        </header>

        {page && page.phase !== "none" ? (
          <>
            {user && page.me?.active ? <Basket me={page.me} total={total} reduced={reduced} /> : null}
            {user ? <Hints me={page.me} /> : null}
            {!user && (running || page.phase === "upcoming") ? (
              <section className="rounded-sm border border-[#e9c46a]/30 bg-[#e9c46a]/5 p-5 flex flex-wrap items-center gap-4" data-testid="easter-guest">
                <p className="flex-1 min-w-[14rem] text-white/80">Eier siehst du auch ohne Konto – sammeln kannst du sie angemeldet. Wer alle {total} findet, ist in der Verlosung.</p>
                <Link to="/login?next=%2Fostern" className="inline-flex items-center gap-2 px-4 py-2 bg-[#e9c46a] text-black font-bold uppercase tracking-wider text-xs rounded-sm"><LogIn className="w-4 h-4" /> Anmelden</Link>
              </section>
            ) : null}

            {page.prizes?.length ? (
              <section className="rounded-sm border border-white/10 bg-[#111] p-5" data-testid="easter-prizes">
                <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Gift className="w-4 h-4 text-[#e9c46a]" /> Preise</h2>
                <ul className="mt-3 grid sm:grid-cols-2 gap-2">
                  {page.prizes.map((prize) => (
                    <li key={prize.kind} className="border border-white/10 rounded-sm p-3 bg-[#0b0b0b]">
                      <div className="text-[10px] uppercase tracking-widest text-[#e9c46a] font-bold">{prize.title}</div>
                      <div className="text-white font-semibold">{prize.label}</div>
                      {prize.value ? <div className="text-xs text-white/50">Wert: {prize.value}</div> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="rounded-sm border border-white/10 bg-[#111] p-5" data-testid="easter-fastest">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Trophy className="w-4 h-4 text-[#ffd700]" /> Die Schnellsten mit vollem Korb</h2>
              {page.fastest?.length ? (
                <ol className="mt-3 divide-y divide-white/5">
                  {page.fastest.map((row) => (
                    <li key={`${row.rank}-${row.username}`} className="flex items-center gap-3 py-2" data-testid={`easter-fastest-${row.rank}`}>
                      <span className="w-7 text-center font-bold text-white/50 tabular-nums">{row.rank}</span>
                      {row.username ? <Link to={`/u/${row.username}`} className="flex-1 truncate font-semibold text-white hover:text-[#e9c46a]">{row.display_name}</Link> : <span className="flex-1 truncate font-semibold text-white">{row.display_name}</span>}
                      <span className="text-sm text-white/60 tabular-nums">{durationLabel(row.duration_seconds)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-white/55">{running ? "Noch hat niemand alle Eier – vielleicht bist du die oder der Erste." : "Diesmal hat niemand mit öffentlichem Profil alle Eier gefunden."}</p>
              )}
              <p className="mt-3 text-xs text-white/40">Hier stehen nur Personen, deren Profil und Erfolge öffentlich sind. {page.completed ? `Insgesamt ${page.completed} mit vollem Korb.` : ""}</p>
            </section>

            <section className="rounded-sm border border-white/10 bg-[#111] p-5" data-testid="easter-terms">
              <h2 className="text-lg font-bold text-white">So läuft die Suche</h2>
              <ul className="mt-3 space-y-1.5 text-sm text-white/70 list-disc pl-5">
                {(page.terms || []).map((line) => <li key={line}>{line}</li>)}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </PublicLayout>
  );
}
