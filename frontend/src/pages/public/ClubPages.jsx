/**
 * Phase D — Statische Vereins-Sub-Pages.
 *
 * BoardPage ist dynamisch: liest /api/board und rendert nur is_active=true. Seit #1332 und #1252: Porträts aus einem
 * Guss (BoardPortrait), offene Funktionen als Einladung „Wir suchen …“ und die Statuten als PDF für alle (Schalter
 * „Statuten öffentlich zeigen“ unter Dolibarr → Funktionen).
 */
import { useCallback, useEffect, useState } from "react";
import { API, api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Reveal } from "@/components/tls/Reveal";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonCards } from "@/components/tls/Skeleton";
import { BoardPortrait, VacancyPortrait } from "@/components/tls/BoardPortrait";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Heart, Target, Sparkles, FileText } from "lucide-react";
import { viennaDate } from "@/lib/vienna";
import { statutesHref } from "@/lib/statutes";

const CORE = ["obmann", "kassier", "schriftfuehrer"];

/** Was auf „Vorstand“ steht: Vorsitz (groß), Stellvertretungen und weitere Funktionen (kleiner) - offene als Einladung. */
export function boardSections(positions) {
  const list = Array.isArray(positions) ? positions : [];
  const core = CORE.map((slug) => list.find((p) => p.slug === slug)).filter(Boolean);
  const rest = list.filter((p) => !CORE.includes(p.slug));
  const deputies = core.filter((p) => p.allow_deputy).map((p) => ({
    key: `${p.id}-stv`, slug: `${p.slug}-stv`, person: p.deputy_user || null, title: p.deputy_user ? (p.deputy_title || p.display_title) : (p.neutral_title || p.title_male),
    label: "Stellvertretung", vacant: !p.deputy_user, text: p.deputy_vacancy_text || "",
  }));
  const entry = (p) => ({
    key: p.id, slug: p.slug, person: p.user || null, title: p.user ? p.display_title : (p.neutral_title || p.display_title || p.title_male),
    label: "", withheld: Boolean(p.name_withheld), vacant: !p.user && !p.name_withheld, text: p.vacancy_text || "",
    since: p.since ? viennaDate(p.since, { month: "long", year: "numeric" }) : "",
  });
  return { core: core.map(entry), deputies, rest: rest.map(entry) };
}

function Seat({ seat, size }) {
  if (seat.vacant) return <VacancyPortrait title={seat.title} label={seat.label} text={seat.text} size={size} testId={`board-vacancy-${seat.slug}`} />;
  return <BoardPortrait person={seat.person} title={seat.title} label={seat.label} withheld={seat.withheld} since={seat.since} size={size} testId={`board-position-${seat.slug}`} />;
}

export function BoardPage() {
  useDocumentTitle("Vorstand", "Vorstand, Ansprechpartner und Vereinsverantwortliche von THE LION SQUAD eSports in Tirol.");
  const [positions, setPositions] = useState([]);
  const [statutes, setStatutes] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/board?active_only=true")
      .then(({ data }) => setPositions(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Statuten (#326 Teil 3, #1252): aus Dolibarr (freigegeben) oder aus den Dokumenten - oder der Hinweis von früher.
    api.get("/board/statutes")
      .then(({ data }) => setStatutes(data))
      .catch(() => setStatutes(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["board", "users", "membership", "documents"]);
  const sections = boardSections(positions);

  return (
    <PublicLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Verein", to: "/about" }, { label: "Vorstand" }]} className="mb-6" />
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Organisation</span>
        <h1 className="mt-2 font-heading text-4xl md:text-5xl font-black uppercase">Vorstand</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Das Team hinter THE LION SQUAD — eSports. Ehrenamtlich, leidenschaftlich, mit klarem Fokus auf Community und Fairplay.
        </p>

        {loading ? (
          <SkeletonCards count={3} image={false} className="mt-10" label="Lade Vorstand" />
        ) : positions.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            Es sind noch keine Vorstandspositionen aktiv.
          </div>
        ) : (
          <div className="mt-10 space-y-10" data-testid="board-grid">
            <Reveal className="tls-reveal-grid grid grid-cols-2 sm:grid-cols-3 gap-4 lg:gap-6 justify-items-center" data-testid="board-core">
              {sections.core.map((seat) => <div key={seat.key} className="tls-reveal-item w-full flex justify-center"><Seat seat={seat} size="lg" /></div>)}
            </Reveal>
            {sections.deputies.length > 0 && (
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50 mb-4">Stellvertretungen</div>
                <Reveal className="tls-reveal-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="board-deputies">
                  {sections.deputies.map((seat) => <div key={seat.key} className="tls-reveal-item"><Seat seat={seat} size="sm" /></div>)}
                </Reveal>
              </div>
            )}
            {sections.rest.length > 0 && (
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50 mb-4">Weitere Funktionen</div>
                <Reveal className="tls-reveal-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="board-special">
                  {sections.rest.map((seat) => <div key={seat.key} className="tls-reveal-item"><Seat seat={seat} size="sm" /></div>)}
                </Reveal>
              </div>
            )}
          </div>
        )}

        <StatutesBox statutes={statutes} />
      </div>
    </PublicLayout>
  );
}

export function formatDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

// Eine Fassung in einem Satz: künftig „gilt ab“, aufgehoben „von … bis“, geltend „seit“.
export function statuteLine(version) {
  if (!version) return "";
  const from = formatDay(version.valid_from);
  if (version.state === "future") return `Fassung ${version.version} gilt ab ${from}`;
  if (version.state === "repealed") return `Fassung ${version.version}: ${from} bis ${formatDay(version.valid_to)}`;
  return `Fassung ${version.version} seit ${from}`;
}

function StatutesBox({ statutes }) {
  const available = Boolean(statutes?.available);
  const current = available ? statutes.current : null;
  const fromDocuments = statutes?.source === "documents";
  const others = available ? (statutes.versions || []).filter((v) => !current || v.id !== current.id) : [];
  return (
    <section id="statuten" className="mt-12 border border-white/10 bg-[#121212] rounded-sm p-5 md:p-6 scroll-mt-24" data-testid="board-statutes">
      <h2 className="font-heading text-xl font-bold uppercase mb-2">Statuten</h2>
      {!available ? (
        <p className="text-sm text-white/60">
          THE LION SQUAD — eSports ist ein eingetragener österreichischer eSports-Verein. Statuten und ZVR-Nummer werden im Mitgliederbereich nach Login angezeigt.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-white/70">Die Statuten sind die Regeln unseres Vereins – wer Mitglied wird, stimmt ihnen zu.</p>
          {current ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" data-testid="board-statutes-current">
              <div className="flex items-start gap-3 min-w-0">
                <FileText className="w-5 h-5 text-[#29B6E8] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-sm text-white font-bold break-words">{fromDocuments ? current.title : `Geltende Fassung: Fassung ${current.version}`}</div>
                  <div className="text-xs text-white/50">
                    {fromDocuments ? `Stand ${formatDay(current.updated_at)}` : `beschlossen am ${formatDay(current.decided_on)} · gültig seit ${formatDay(current.valid_from)}`}
                  </div>
                </div>
              </div>
              <a href={statutesHref(statutes)} target="_blank" rel="noreferrer" data-testid={`board-statutes-pdf-${current.id}`} className="tls-btn tls-btn--secondary inline-flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2.5 font-bold uppercase tracking-wider text-xs rounded-sm">
                <FileText className="w-4 h-4" /> Statuten (PDF)
              </a>
            </div>
          ) : (
            <p className="text-sm text-white/60" data-testid="board-statutes-none">
              {statutes.state === "ambiguous" ? "Welche Fassung heute gilt, ist in der Vereinsverwaltung noch nicht eindeutig." : "Derzeit ist noch keine Fassung in Kraft."}
            </p>
          )}
          {others.length > 0 && (
            <ul className="text-xs text-white/50 space-y-1" data-testid="board-statutes-archive">
              {others.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-2">
                  <span>{statuteLine(v)}</span>
                  <a href={`${API}/board/statutes/${v.id}/pdf`} target="_blank" rel="noreferrer" data-testid={`board-statutes-pdf-${v.id}`} className="text-[#29B6E8] hover:underline">PDF</a>
                </li>
              ))}
            </ul>
          )}
          {!fromDocuments && <p className="text-xs text-white/40">Die Fassungen kommen aus der Vereinsverwaltung; jede Datei wird gegen die Prüfsumme der Vereinsakte geprüft.</p>}
        </div>
      )}
    </section>
  );
}

export function ValuesPage() {
  useDocumentTitle("Werte & Ziele", "Fairplay, Zusammenhalt, Gaming-Kultur und Vereinsziele von THE LION SQUAD eSports.");
  return (
    <PublicLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Verein", to: "/about" }, { label: "Werte & Ziele" }]} className="mb-6" />
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Identität</span>
        <h1 className="mt-2 font-heading text-4xl md:text-5xl font-black uppercase">Werte & Ziele</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Was uns ausmacht, wofür wir stehen, und wohin wir wollen.
        </p>

        <Reveal className="tls-reveal-grid mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { icon: Heart, title: "Rudel-Mentalität", text: "Wir gewinnen gemeinsam, wir verlieren gemeinsam, wir feiern gemeinsam. Niemand wird zurückgelassen." },
            { icon: Sparkles, title: "Fairplay", text: "Respekt vor Gegnern, Schiedsrichtern, Teammates. Cheating, Toxic Behaviour und Diskriminierung haben bei uns keinen Platz." },
            { icon: Target, title: "Ambition", text: "Spaß zuerst — aber wir wollen besser werden, lernen, wachsen. Ob Casual oder Competitive: Jeder Pixel zählt." },
          ].map((v) => (
            <div key={v.title} className="tls-reveal-item border border-white/10 rounded-sm p-6 bg-gradient-to-br from-white/[0.02] to-transparent">
              <v.icon className="w-6 h-6 text-[#29B6E8] mb-3" />
              <div className="font-heading text-lg font-black uppercase">{v.title}</div>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">{v.text}</p>
            </div>
          ))}
        </Reveal>

        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="font-heading text-2xl font-bold uppercase mb-4">Unsere Ziele</h2>
          <ul className="space-y-3 text-white/80 max-w-2xl">
            <li>🦁 <strong>Eine Heimat schaffen</strong> für eSports-Begeisterte aller Plattformen, Spiele und Skill-Level.</li>
            <li>🏁 <strong>Reguläre Vereinsevents</strong> (online &amp; offline) mit Pokal, Preisen und gutem Essen.</li>
            <li>🏆 <strong>Eigene Turnierserie</strong> mit Jahreswertung, Erfolgen und Hall of Fame.</li>
            <li>🎮 <strong>Förderung des Nachwuchses</strong> — auch für Kinder &amp; Jugendliche, mit klaren Regeln und sicheren Strukturen.</li>
            <li>🤝 <strong>Kooperationen mit anderen Vereinen</strong>, Streamern, Spielentwicklern und Sponsoren.</li>
          </ul>
        </div>
      </div>
    </PublicLayout>
  );
}
