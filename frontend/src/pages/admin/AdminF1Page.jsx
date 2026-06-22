import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { downloadCsv, formatAdminDate, normalizeSearch } from "@/lib/adminListTools";
import { sortByNearestDate } from "@/lib/contentSort";
import { Plus, Flag, Search, Download } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const FAST_LAP_STATUS_OPTIONS = [
  ["", "Alle Status"],
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
  ["registration_open", "Einreichung offen"],
  ["live", "Live"],
  ["completed", "Abgeschlossen"],
  ["results_published", "Ergebnisse online"],
  ["archived", "Archiviert"],
  ["cancelled", "Abgesagt"],
];

export default function AdminF1Page() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const load = useCallback(() => api.get("/f1/challenges?include_drafts=true").then(({ data }) => setList(data)), []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["f1"]);

  useEffect(() => {
    const nextQuery = searchParams.get("q") || "";
    const nextStatus = searchParams.get("status") || "";
    if (nextQuery !== query) setQuery(nextQuery);
    if (nextStatus !== statusFilter) setStatusFilter(nextStatus);
  }, [query, searchParams, statusFilter]);

  const updateFilterParams = (patch) => {
    const nextQuery = Object.prototype.hasOwnProperty.call(patch, "q") ? patch.q : query;
    const nextStatus = Object.prototype.hasOwnProperty.call(patch, "status") ? patch.status : statusFilter;
    setQuery(nextQuery);
    setStatusFilter(nextStatus);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextQuery) params.set("q", nextQuery);
      else params.delete("q");
      if (nextStatus) params.set("status", nextStatus);
      else params.delete("status");
      return params;
    }, { replace: true });
  };

  const statusCounts = useMemo(() => list.reduce((acc, challenge) => {
    const key = challenge.status || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}), [list]);
  const sortedList = useMemo(() => sortByNearestDate(list), [list]);
  const filteredList = useMemo(() => {
    const needle = normalizeSearch(query);
    return sortedList.filter((challenge) => {
      if (statusFilter && challenge.status !== statusFilter) return false;
      if (!needle) return true;
      const haystack = normalizeSearch([
        challenge.title,
        challenge.slug,
        challenge.description,
        challenge.status,
        challenge.visibility,
      ].filter(Boolean).join(" "));
      return haystack.includes(needle);
    });
  }, [query, sortedList, statusFilter]);

  const exportCsv = () => {
    downloadCsv(
      `tls-fast-lap-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Titel", "Slug", "Status", "Start", "Strecken", "Fahrer"],
      filteredList.map((challenge) => [
        challenge.title,
        challenge.slug,
        challenge.status,
        formatAdminDate(challenge.start_date),
        challenge.track_count,
        challenge.participant_count,
      ]),
    );
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Fast Lap</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase">Challenges</h1>
        </div>
        {isAdmin && (
          <Link to="/admin/f1/new" data-testid="admin-f1-new-btn" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2]">
            <Plus className="w-4 h-4" /> Neue Challenge
          </Link>
        )}
      </div>
      {list.length > 0 && (
        <div className="mb-4 rounded-sm border border-white/10 bg-[#121212] p-3">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(16rem,1fr)_14rem_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <input
                value={query}
                onChange={(event) => updateFilterParams({ q: event.target.value })}
                placeholder="Challenge, Slug oder Beschreibung suchen"
                data-testid="f1-admin-search"
                className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] py-2 pl-9 pr-3 text-sm focus:border-[#29B6E8] focus:outline-none"
              />
            </label>
            <select value={statusFilter} onChange={(event) => updateFilterParams({ status: event.target.value })} data-testid="f1-admin-status-filter" className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
              {FAST_LAP_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value || "all"} value={value}>{label} ({value ? statusCounts[value] || 0 : list.length})</option>
              ))}
            </select>
            <button
              type="button"
              onClick={exportCsv}
              disabled={filteredList.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-sm border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/65 hover:border-[#29B6E8]/45 hover:text-white disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
          <div className="mt-2 text-xs text-white/45">{filteredList.length} / {list.length} Challenges sichtbar</div>
        </div>
      )}
      <div className="space-y-3">
        {filteredList.map((c) => (
          <Link key={c.id} to={`/admin/f1/${c.id}`} data-testid={`admin-f1-row-${c.slug}`} className="block border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
            <div className="flex items-center gap-4">
              <Flag className="w-6 h-6 text-[#29B6E8]" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><StatusBadge status={c.status} /></div>
                <h3 className="font-heading text-xl font-bold">{c.title}</h3>
                <div className="text-xs text-white/50">{c.track_count} Strecken · {c.participant_count} Fahrer</div>
              </div>
            </div>
          </Link>
        ))}
        {list.length === 0 && <div className="text-center py-16 text-white/40 font-display tracking-widest">KEINE CHALLENGES</div>}
        {list.length > 0 && filteredList.length === 0 && <div className="text-center py-16 text-white/40 font-display tracking-widest">KEINE CHALLENGES FÜR DIESEN FILTER</div>}
      </div>
    </AdminLayout>
  );
}
