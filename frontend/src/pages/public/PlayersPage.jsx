import { useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Reveal } from "@/components/tls/Reveal";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Search, Crown } from "lucide-react";
import { AccountLevelPill, accountLevelFrameClass } from "@/components/tls/AccountLevel";
import { LevelAvatarFrame, useCrowns } from "@/components/tls/LevelAvatarFrame";
import { SkeletonList } from "@/components/tls/Skeleton";
import { FriendsPanel } from "@/pages/user/profile/FriendsPanel";
import { useAuth } from "@/context/AuthContext";
import { useLoad } from "@/hooks/useLoad";
import { LoadState } from "@/components/tls/LoadState";

const PAGE_SIZE = 48;

export default function PlayersPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  useDocumentTitle("Community-Spieler", "Öffentliche Community-Profile registrierter Benutzer von THE LION SQUAD eSports.", {
    robots: "noindex, follow",
  });

  // Spieler und Vereinsmitglieder getrennt geladen (#984, #985): nur die Antwort auf den aktuellen Begriff und die
  // aktuelle Seite zählt; beim Tippen wird erst gefragt, wenn die Eingabe kurz ruht. Ein Fehler ist kein „Keine Spieler
  // gefunden“.
  const needle = q.trim();
  const players = useLoad(["players", page, needle], ({ signal }) => api.get("/users/public-list", {
    params: { paged: true, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, q: needle || undefined },
    signal,
  }).then(({ data }) => ({ items: data?.items || [], total: Number(data?.total || 0) })), { debounceMs: needle ? 250 : 0 });
  const members = useLoad("membership/public", ({ signal }) => api.get("/membership/public", { signal }).then(({ data }) => (Array.isArray(data) ? data : [])));
  const reloadAll = () => Promise.all([players.reload(), members.reload()]);
  useApiInvalidation(reloadAll, ["users", "membership", "achievements"]);

  const memberUsernames = new Set((members.data || []).map((m) => m.username));
  const crowns = useCrowns();
  // Die Mitglieder-Liste filtert die Seite selbst nach dem Begriff.
  const memberHits = (rows) => (needle ? rows.filter((p) => `${p.username} ${p.display_name || ""}`.toLowerCase().includes(needle.toLowerCase())) : rows);
  const total = players.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const renderGrid = (rows) => (rows.length === 0 ? <NoPlayers /> : <PlayerGrid players={rows} memberUsernames={memberUsernames} crowns={crowns} />);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">COMMUNITY</span>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Spieler</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Alle Spieler der TLS Community. Klick auf ein Profil, um Statistiken, Auszeichnungen und Spiel-Historie zu sehen.
        </p>
        {/* Spieler und Freunde (#1143): wie in der App unter Community - deine Freunde und offenen Anfragen zuerst. */}
        {user ? (
          <div className="mt-8" data-testid="players-friends">
            <h2 className="font-heading text-2xl font-black uppercase mb-3">Deine Freunde</h2>
            <FriendsPanel />
          </div>
        ) : null}

        <div className="mt-8 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex gap-2">
            <button onClick={() => setTab("all")} data-testid="players-tab-all" className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${tab === "all" ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}>Alle</button>
            <button onClick={() => setTab("members")} data-testid="players-tab-members" className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${tab === "members" ? "bg-[#FFD700] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}>Vereinsmitglieder</button>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Spieler suchen…"
              data-testid="players-search"
              className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] pl-9 pr-3 py-2 rounded-sm text-sm"
            />
          </div>
        </div>

        <div className="mt-8">
          {tab === "members" ? (
            <LoadState
              load={members}
              loading={<SkeletonList rows={6} label="Lade Spieler" />}
              errorTitle="Die Vereinsmitglieder konnten nicht geladen werden"
              empty={<NoPlayers />}
            >
              {(rows) => renderGrid(memberHits(rows))}
            </LoadState>
          ) : (
            <LoadState
              load={players}
              loading={<SkeletonList rows={6} label="Lade Spieler" />}
              errorTitle="Die Spieler konnten nicht geladen werden"
              empty={<NoPlayers />}
            >
              {(data) => renderGrid(data.items)}
            </LoadState>
          )}
        </div>
        {tab === "all" && players.status === "ok" && totalPages > 1 && (
          <div className="mt-8 flex items-center justify-between gap-3 text-sm text-white/55">
            <span>{total.toLocaleString("de-DE")} öffentliche Profile</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm disabled:opacity-40">Zurück</button>
              <span className="text-xs uppercase tracking-widest">Seite {page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm disabled:opacity-40">Weiter</button>
            </div>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function NoPlayers() {
  return <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">Keine Spieler gefunden.</div>;
}

function PlayerGrid({ players, memberUsernames, crowns }) {
  return (
    <Reveal className="tls-reveal-grid tls-dim-siblings grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
      {players.map((p) => {
        const isMember = memberUsernames.has(p.username);
        const accountLevel = p.achievement_level?.level || 1;
        return (
          <Link
            key={p.username}
            to={`/u/${p.username}`}
            data-testid={`player-card-${p.username}`}
            className={`tls-card tls-reveal-item border ${accountLevelFrameClass(accountLevel)} rounded-sm bg-[#121212] p-4 group`}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <LevelAvatarFrame level={accountLevel} crown={crowns?.[p.id] || null} compact>
                  {p.avatar_url ? (
                    <img src={resolveMediaUrl(p.avatar_url)} alt={p.display_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className={`font-heading font-black ${isMember ? "text-[#FFD700]" : "text-white/40"}`}>{(p.display_name || p.username)[0]}</span>
                    </div>
                  )}
                </LevelAvatarFrame>
                {p.profile_completeness != null && (
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#0A0A0A] border border-white/20 flex items-center justify-center" title={`Profil ${p.profile_completeness}% komplett`}>
                    <span className="text-[8px] font-bold tabular-nums text-white/70">{p.profile_completeness}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="tls-card__title font-heading font-bold text-white truncate flex items-center gap-1.5">
                  {p.display_name || p.username}
                  {isMember && <Crown className="w-3 h-3 text-[#FFD700] shrink-0" />}
                </div>
                <div className="text-[11px] text-white/45 truncate">@{p.username}</div>
              </div>
            </div>
            {/* Phase C: Top Achievement chip + count */}
            {p.top_achievement && (
              <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-widest" data-testid={`player-top-${p.username}`}>
                <span className="px-1.5 py-0.5 rounded-sm border" style={{ color: p.top_achievement.level_color, borderColor: p.top_achievement.level_color + "55" }}>
                  {p.top_achievement.level_name} · {p.top_achievement.name}
                </span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-white/35">
              <span>{p.achievements_count || 0} Erfolge</span>
              {p.achievement_level && <AccountLevelPill level={p.achievement_level.level} className="px-1.5 py-0 text-[9px]" />}
            </div>
          </Link>
        );
      })}
    </Reveal>
  );
}
