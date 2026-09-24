/**
 * Phase D — Statische Vereins-Sub-Pages.
 *
 * BoardPage ist jetzt dynamisch: liest /api/board und rendert nur is_active=true.
 */
import { useCallback, useEffect, useState } from "react";
import { API, api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonCards } from "@/components/tls/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Crown, Heart, Target, Sparkles, User as UserIcon, ArrowRight, FileText } from "lucide-react";
import { Link } from "react-router-dom";

function personGamertag(person) {
  return person?.gamertag || person?.username || person?.display_name;
}

function personRealName(person) {
  const tag = personGamertag(person);
  return person?.real_name || (person?.display_name && person.display_name !== tag ? person.display_name : "");
}

export function BoardPage() {
  useDocumentTitle("Vorstand", "Vorstand, Ansprechpartner und Vereinsverantwortliche von THE LION SQUAD eSports in Tirol.");
  const [positions, setPositions] = useState([]);
  const [statutes, setStatutes] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/board?active_only=true")
      .then(({ data }) => setPositions(data))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Statuten aus Dolibarr (#326 Teil 3) - ohne Schalter oder Freigabe bleibt der Hinweis von früher.
    api.get("/board/statutes")
      .then(({ data }) => setStatutes(data))
      .catch(() => setStatutes(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["board", "users", "membership"]);

  return (
    <PublicLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Verein", to: "/about" }, { label: "Vorstand" }]} className="mb-6" />
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Organisation</span>
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
          <div className="mt-10 space-y-8" data-testid="board-grid">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {getCoreBoardPositions(positions).map((p) => (
                <BoardRoleColumn key={p.id} p={p} />
              ))}
            </div>
            {getSpecialBoardPositions(positions).length > 0 && (
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] mb-4">Sonderfunktionen</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {getSpecialBoardPositions(positions).map((p) => (
                    <BoardCard key={p.id} p={p} compact />
                  ))}
                </div>
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
  const others = available ? (statutes.versions || []).filter((v) => !current || v.id !== current.id) : [];
  return (
    <div className="mt-10 border border-white/10 bg-[#121212] rounded-sm p-6" data-testid="board-statutes">
      <h2 className="font-heading text-xl font-bold uppercase mb-2">Statuten & Vereinsregister</h2>
      {!available ? (
        <p className="text-sm text-white/60">
          THE LION SQUAD — eSports ist ein eingetragener österreichischer eSports-Verein. Statuten und ZVR-Nummer werden im Mitgliederbereich nach Login angezeigt.
        </p>
      ) : (
        <div className="space-y-4">
          {current ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" data-testid="board-statutes-current">
              <div>
                <div className="text-sm text-white font-bold">Geltende Fassung: Fassung {current.version}</div>
                <div className="text-xs text-white/50">beschlossen am {formatDay(current.decided_on)} · gültig seit {formatDay(current.valid_from)}</div>
              </div>
              <a href={`${API}/board/statutes/${current.id}/pdf`} target="_blank" rel="noreferrer" data-testid={`board-statutes-pdf-${current.id}`} className="inline-flex items-center gap-2 px-4 py-2 border border-[#FFD700]/60 text-[#FFD700] font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#FFD700]/10">
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
                  <a href={`${API}/board/statutes/${v.id}/pdf`} target="_blank" rel="noreferrer" data-testid={`board-statutes-pdf-${v.id}`} className="text-[#FFD700] hover:underline">PDF</a>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-white/40">Die Fassungen kommen aus der Vereinsverwaltung; jede Datei wird gegen die Prüfsumme der Vereinsakte geprüft.</p>
        </div>
      )}
    </div>
  );
}

function getCoreBoardPositions(positions) {
  const priority = ["obmann", "kassier", "schriftfuehrer"];
  return priority.map((slug) => positions.find((p) => p.slug === slug)).filter(Boolean);
}

function getSpecialBoardPositions(positions) {
  const core = new Set(["obmann", "kassier", "schriftfuehrer"]);
  return positions.filter((p) => !core.has(p.slug));
}

function BoardRoleColumn({ p }) {
  return (
    <div className="space-y-3" data-testid={`board-position-${p.slug}`}>
      <BoardCard p={p} featured />
      {p.allow_deputy && (
        <BoardDeputyCard position={p} />
      )}
    </div>
  );
}

// Aus Dolibarr (#326 Teil 2) kommen Posten ohne Profil-Link (nur Name), ohne Namen („nicht
// freigegeben“) oder unbesetzt - jede Lage sagt ehrlich, was gilt.
function boardPersonTarget(u) {
  if (!u) return null;
  if (u.profile_url) return u.profile_url;
  return u.username ? `/u/${u.username}` : null;
}

function BoardEmpty({ p, compact }) {
  const text = p.name_withheld ? "Name nicht freigegeben" : p.vacant ? "Unbesetzt" : "Position offen";
  return <div className={`${compact ? "mt-3" : "m-5"} text-[10px] uppercase tracking-widest text-white/40`} data-testid={`board-empty-${p.slug}`}>{text}</div>;
}

function BoardCard({ p, compact = false, featured = false }) {
  const u = p.user;
  const target = boardPersonTarget(u);
  const Wrapper = target ? Link : "div";
  const wrapperProps = target ? { to: target } : {};
  return (
    <div className={`border rounded-sm bg-[#121212] hover:border-[#FFD700]/40 transition overflow-hidden ${featured ? "border-[#FFD700]/30" : "border-white/10"} ${compact ? "p-5" : ""}`}>
      {!compact && (
        <div className="px-5 pt-5">
          <Crown className="w-5 h-5 text-[#FFD700] mb-3" />
          <div className="font-heading font-bold uppercase">{p.display_title}</div>
          {p.description && <p className="mt-2 text-sm text-white/55">{p.description}</p>}
        </div>
      )}
      {compact && (
        <>
          <Crown className="w-5 h-5 text-[#FFD700] mb-3" />
          <div className="font-heading font-bold uppercase">{p.display_title}</div>
          {p.description && <p className="mt-2 text-sm text-white/55">{p.description}</p>}
        </>
      )}

      {u ? (
        <Wrapper {...wrapperProps} className={`${compact ? "mt-4" : "mt-5"} flex ${compact ? "items-center gap-3" : "flex-col"} group`} data-testid={`board-person-${p.slug}`}>
          {!compact && (
            <div className="relative min-h-[17rem] bg-[radial-gradient(circle_at_50%_15%,rgba(255,215,0,0.14),rgba(10,10,10,0)_68%)] overflow-hidden">
              {u.avatar_url ? (
                <img src={resolveMediaUrl(u.avatar_url)} alt="" className="absolute inset-x-0 bottom-0 mx-auto h-[108%] w-full object-contain object-bottom group-hover:scale-[1.025] transition duration-500" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <UserIcon className="w-12 h-12 text-white/20" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black via-black/70 to-transparent">
                <div className="font-heading text-xl font-black text-white group-hover:text-[#FFD700] transition uppercase truncate">{personGamertag(u)}</div>
                {personRealName(u) && <div className="mt-0.5 text-xs text-white/55 truncate">{personRealName(u)}</div>}
                {u.role_title && <div className="mt-1 text-[10px] uppercase tracking-widest text-white/45">{u.role_title}</div>}
                {p.since && <div className="mt-1 text-[10px] uppercase tracking-widest text-white/45">seit {new Date(p.since).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</div>}
              </div>
            </div>
          )}
          {compact && (
            <>
              {u.avatar_url ? (
                <img src={resolveMediaUrl(u.avatar_url)} alt="" className="w-12 h-12 rounded-sm object-contain object-bottom bg-[#0A0A0A] border border-white/10" />
              ) : (
                <div className="w-12 h-12 rounded-sm bg-[#0A0A0A] border border-white/10 flex items-center justify-center">
                  <UserIcon className="w-5 h-5 text-white/40" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white text-sm group-hover:text-[#FFD700] transition truncate">{personGamertag(u)}</div>
                {personRealName(u) && <div className="text-[10px] text-white/50 truncate">{personRealName(u)}</div>}
                <div className="text-[10px] text-white/40 uppercase tracking-widest">{u.source === "member_profile" ? "Vereinsprofil" : u.source === "dolibarr" ? "laut Vereinsregister" : `@${u.username}`}</div>
              </div>
              {target && <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-[#FFD700] transition" />}
            </>
          )}
        </Wrapper>
      ) : (
        <BoardEmpty p={p} compact={compact} />
      )}
    </div>
  );
}

function BoardDeputyCard({ position }) {
  const d = position.deputy_user;
  const title = `${position.display_title || position.title_male}-Stv.`;
  if (!d) {
    return (
      <div className="border border-dashed border-white/10 rounded-sm bg-[#0A0A0A] p-6 text-[11px] uppercase tracking-widest text-white/35 min-h-[10rem] flex items-center">
        {title} offen
      </div>
    );
  }
  return (
    <Link to={d.profile_url || `/u/${d.username}`} className="group border border-white/10 rounded-sm bg-[#0A0A0A] p-6 flex items-center gap-5 min-h-[11.5rem] hover:border-[#FFD700]/40 hover:bg-[#121212] transition">
      {d.avatar_url ? (
        <img src={resolveMediaUrl(d.avatar_url)} alt="" className="w-28 h-32 rounded-sm object-contain object-bottom bg-black border border-white/10" />
      ) : (
        <div className="w-28 h-32 rounded-sm bg-black border border-white/10 flex items-center justify-center">
          <UserIcon className="w-8 h-8 text-white/35" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[#FFD700]/70 font-bold">{title}</div>
        <div className="mt-1 font-heading text-xl md:text-2xl font-black uppercase group-hover:text-[#FFD700] transition truncate">{personGamertag(d)}</div>
        {personRealName(d) && <div className="text-sm text-white/55 truncate">{personRealName(d)}</div>}
      </div>
    </Link>
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

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { icon: Heart, title: "Rudel-Mentalität", text: "Wir gewinnen gemeinsam, wir verlieren gemeinsam, wir feiern gemeinsam. Niemand wird zurückgelassen." },
            { icon: Sparkles, title: "Fairplay", text: "Respekt vor Gegnern, Schiedsrichtern, Teammates. Cheating, Toxic Behaviour und Diskriminierung haben bei uns keinen Platz." },
            { icon: Target, title: "Ambition", text: "Spaß zuerst — aber wir wollen besser werden, lernen, wachsen. Ob Casual oder Competitive: Jeder Pixel zählt." },
          ].map((v) => (
            <div key={v.title} className="border border-white/10 rounded-sm p-6 bg-gradient-to-br from-white/[0.02] to-transparent">
              <v.icon className="w-6 h-6 text-[#29B6E8] mb-3" />
              <div className="font-heading text-lg font-black uppercase">{v.title}</div>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">{v.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-white/10 pt-8">
          <h2 className="font-heading text-2xl font-bold uppercase mb-4">Unsere Ziele</h2>
          <ul className="space-y-3 text-white/80 max-w-2xl">
            <li>🦁 <strong>Eine Heimat schaffen</strong> für eSports-Begeisterte aller Plattformen, Spiele und Skill-Level.</li>
            <li>🏁 <strong>Reguläre Vereinsevents</strong> (online &amp; offline) mit Pokal, Preisen und gutem Essen.</li>
            <li>🏆 <strong>Eigene Turnierserie</strong> mit Jahreswertung, Achievements und Hall of Fame.</li>
            <li>🎮 <strong>Förderung des Nachwuchses</strong> — auch für Kinder &amp; Jugendliche, mit klaren Regeln und sicheren Strukturen.</li>
            <li>🤝 <strong>Kooperationen mit anderen Vereinen</strong>, Streamern, Spielentwicklern und Sponsoren.</li>
          </ul>
        </div>
      </div>
    </PublicLayout>
  );
}
