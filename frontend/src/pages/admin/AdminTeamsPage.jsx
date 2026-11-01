import { useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Search, UserX, Users } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { LoadState } from "@/components/tls/LoadState";
import { SkeletonList } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useLoad } from "@/hooks/useLoad";
import { DissolvedTeamRow } from "@/pages/public/team/DissolvedTeams";
import { viennaDate } from "@/lib/vienna";

// Teamverwaltung (#2128, TM7): alle Teams mit Suche - auch private; ein Team ohne aktive Teamleitung fällt auf. Verwaltet
// wird ein Team auf seiner Teamseite, die Zeile führt dorthin. Darunter die aufgelösten Teams mit „Wiederherstellen“ und
// für Club-Admins „Alle Beitrittscodes erneuern“ (TM10): einmal alle neu, mit Rückfrage und Protokoll; die Codes sieht
// hier niemand, die Teamleitungen finden sie auf ihrer Teamseite.

const PAGE_SIZE = 50;
const TABS = [
  { key: "active", label: "Aktive Teams" },
  { key: "dissolved", label: "Aufgelöste Teams" },
];

function TeamRow({ team }) {
  const leader = team.leader?.display_name || team.leader?.username;
  return (
    <Link to={`/teams/${team.id}`} data-testid={`admin-team-${team.id}`} className="tls-card block border border-white/10 bg-[#121212] rounded-sm p-3 hover:border-[#29B6E8]/40">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 bg-[#0A0A0A] border border-white/10 rounded-sm overflow-hidden flex items-center justify-center shrink-0">
          {team.logo_url ? <img src={resolveMediaUrl(team.logo_url)} alt="" className="w-full h-full object-cover" /> : <span className="font-heading font-black text-xs text-[#29B6E8]">{team.tag}</span>}
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <div className="font-heading font-bold [overflow-wrap:anywhere]">{team.name} <span className="text-xs text-[#29B6E8]">[{team.tag}]</span></div>
          <div className="text-xs text-white/50 [overflow-wrap:anywhere]">
            {team.leader_gone
              ? <span className="inline-flex items-center gap-1 text-[#FF6B6B] font-bold" data-testid={`admin-team-orphan-${team.id}`}><UserX className="w-3 h-3" aria-hidden="true" /> Ohne aktive Teamleitung</span>
              : <>Teamleitung: {leader || "Unbekannt"}</>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
          <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" aria-hidden="true" /> {team.member_count}</span>
          <span>{team.squad_count} {team.squad_count === 1 ? "Co-Team" : "Co-Teams"}</span>
          {team.is_public === false ? <span className="inline-flex items-center gap-1 text-white/80 font-bold" data-testid={`admin-team-private-${team.id}`}><Lock className="w-3 h-3" aria-hidden="true" /> Privat</span> : null}
          {team.created_at ? <span>seit {viennaDate(team.created_at)}</span> : null}
        </div>
      </div>
    </Link>
  );
}

export default function AdminTeamsPage() {
  const [tab, setTab] = useState("active");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const needle = query.trim();
  const load = useLoad(["admin-teams", tab, needle, page], ({ signal }) => (
    api.get("/admin/teams", { params: { state: tab, q: needle || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }, signal }).then(({ data }) => data)
  ), { debounceMs: needle ? 220 : 0, isEmpty: (data) => !(data?.items || []).length });
  useApiInvalidation(load.reload, ["teams"]);

  const data = load.data || {};
  const total = Number(data.total || 0);

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">eSports</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Teams</h1>
      <p className="mt-2 text-white/55 text-sm max-w-2xl">
        Alle Teams, auch private. Mitglieder, Rollen und Leitung verwaltest du auf der Teamseite – ein Klick auf die Zeile führt dorthin.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2" role="tablist" aria-label="Teams">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => { setTab(entry.key); setPage(0); }}
            data-testid={`admin-teams-tab-${entry.key}`}
            className={`min-h-11 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm border ${tab === entry.key ? "bg-[#29B6E8] text-black border-[#29B6E8]" : "border-white/10 text-white/60 hover:text-white hover:border-white/20"}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-4 relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          placeholder="Name oder Kürzel suchen"
          aria-label="Teams suchen"
          data-testid="admin-teams-search"
          className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm"
        />
      </div>

      <div className="mt-5">
        <LoadState
          load={load}
          loading={<SkeletonList count={5} label="Lade Teams" />}
          errorTitle="Die Teams konnten nicht geladen werden"
          empty={(
            <div className="border border-dashed border-white/15 rounded-sm p-10 text-center text-sm text-white/45" data-testid="admin-teams-empty">
              {needle ? "Kein Team passt zu deiner Suche." : tab === "dissolved" ? "Gerade ist kein aufgelöstes Team wiederherstellbar." : "Noch keine Teams."}
            </div>
          )}
        >
          {(result) => (
            <div className="space-y-2" data-testid="admin-teams-list">
              {tab === "dissolved" ? (
                <p className="text-xs text-white/50">Aufgelöste Teams lassen sich {result.restore_days} Tage lang wiederherstellen{result.can_restore ? "" : " – das machen die frühere Teamleitung und Club-Admins"}. Danach bleiben nur Name und Kürzel für alte Turniere.</p>
              ) : null}
              {(result.items || []).map((team) => (tab === "dissolved" && result.can_restore
                ? <DissolvedTeamRow key={team.id} team={team} onRestored={load.reload} />
                : tab === "dissolved"
                  ? <div key={team.id} className="border border-white/10 bg-[#121212] rounded-sm p-3 text-sm" data-testid={`admin-dissolved-${team.id}`}>{team.name} <span className="text-xs text-white/50">[{team.tag}]</span></div>
                  : <TeamRow key={team.id} team={team} />))}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-white/50">
                <span data-testid="admin-teams-count">{total} {total === 1 ? "Team" : "Teams"}</span>
                {total > PAGE_SIZE ? (
                  <span className="flex items-center gap-2">
                    <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="tls-btn tls-btn--quiet min-h-11 px-3 py-1.5 rounded-sm text-[11px] uppercase tracking-wider font-bold disabled:opacity-40">Zurück</button>
                    <span>Seite {page + 1} von {Math.ceil(total / PAGE_SIZE)}</span>
                    <button type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)} data-testid="admin-teams-next" className="tls-btn tls-btn--quiet min-h-11 px-3 py-1.5 rounded-sm text-[11px] uppercase tracking-wider font-bold disabled:opacity-40">Weiter</button>
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </LoadState>
      </div>

    </AdminLayout>
  );
}
