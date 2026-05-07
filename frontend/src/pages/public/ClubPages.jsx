/**
 * Phase D — Statische Vereins-Sub-Pages.
 *
 * BoardPage ist jetzt dynamisch: liest /api/board und rendert nur is_active=true.
 */
import { useCallback, useEffect, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Crown, Heart, Target, Sparkles, User as UserIcon, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export function BoardPage() {
  useDocumentTitle("Vorstand", "Der Vorstand von THE LION SQUAD eSports.");
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/board?active_only=true")
      .then(({ data }) => setPositions(data))
      .catch(() => {})
      .finally(() => setLoading(false));
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
          <div className="mt-10 text-white/40">Lade …</div>
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

        <div className="mt-10 border border-white/10 bg-[#121212] rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold uppercase mb-2">Statuten & Vereinsregister</h2>
          <p className="text-sm text-white/60">
            THE LION SQUAD — eSports ist ein eingetragener österreichischer eSports-Verein. Statuten und ZVR-Nummer werden im Mitgliederbereich nach Login angezeigt.
          </p>
        </div>
      </div>
    </PublicLayout>
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

function BoardCard({ p, compact = false, featured = false }) {
  const u = p.user;
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
        <Link to={u.profile_url || `/u/${u.username}`} className={`${compact ? "mt-4" : "mt-5"} flex ${compact ? "items-center gap-3" : "flex-col"} group`}>
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
                <div className="font-heading text-xl font-black text-white group-hover:text-[#FFD700] transition uppercase truncate">{u.display_name || u.username}</div>
                {u.role_title && <div className="mt-1 text-[10px] uppercase tracking-widest text-white/45">{u.role_title}</div>}
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
                <div className="font-bold text-white text-sm group-hover:text-[#FFD700] transition truncate">{u.display_name || u.username}</div>
                <div className="text-[10px] text-white/40 uppercase tracking-widest">{u.source === "member_profile" ? "Vereinsprofil" : `@${u.username}`}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-[#FFD700] transition" />
            </>
          )}
        </Link>
      ) : (
        <div className={`${compact ? "mt-3" : "m-5"} text-[10px] uppercase tracking-widest text-white/40`}>Position offen</div>
      )}
    </div>
  );
}

function BoardDeputyCard({ position }) {
  const d = position.deputy_user;
  const title = `${position.display_title || position.title_male}-Stv.`;
  if (!d) {
    return (
      <div className="border border-dashed border-white/10 rounded-sm bg-[#0A0A0A] p-4 text-[10px] uppercase tracking-widest text-white/35">
        {title} offen
      </div>
    );
  }
  return (
    <Link to={d.profile_url || `/u/${d.username}`} className="group border border-white/10 rounded-sm bg-[#0A0A0A] p-4 flex items-center gap-3 hover:border-[#FFD700]/40 transition">
      {d.avatar_url ? (
        <img src={resolveMediaUrl(d.avatar_url)} alt="" className="w-14 h-16 rounded-sm object-contain object-bottom bg-black border border-white/10" />
      ) : (
        <div className="w-14 h-16 rounded-sm bg-black border border-white/10 flex items-center justify-center">
          <UserIcon className="w-5 h-5 text-white/35" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-white/40">{title}</div>
        <div className="mt-1 font-heading font-bold uppercase group-hover:text-[#FFD700] transition truncate">{d.display_name || d.username}</div>
      </div>
    </Link>
  );
}

export function ValuesPage() {
  useDocumentTitle("Werte & Ziele", "Werte und Ziele des Vereins THE LION SQUAD eSports.");
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
            <li>🏆 <strong>Eigene Turnierserie</strong> mit Season Pass, Achievements und Hall of Fame.</li>
            <li>🎮 <strong>Förderung des Nachwuchses</strong> — auch für Kinder &amp; Jugendliche, mit klaren Regeln und sicheren Strukturen.</li>
            <li>🤝 <strong>Kooperationen mit anderen Vereinen</strong>, Streamern, Spielentwicklern und Sponsoren.</li>
          </ul>
        </div>
      </div>
    </PublicLayout>
  );
}
