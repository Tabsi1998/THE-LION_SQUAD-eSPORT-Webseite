import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { eventTypeLabel } from "@/lib/eventTypes";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { SkeletonLines } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { downloadCsv, formatAdminDate, normalizeSearch } from "@/lib/adminListTools";
import { sortByNearestDate } from "@/lib/contentSort";
import { toast } from "sonner";
import { Plus, X, Trash2, Calendar, UserCheck, Search, Download, FileText } from "lucide-react";

// Event-Liste. Anlegen und Bearbeiten sind seit #434 eigene Seiten (`/admin/events/new`,
// `/admin/events/:id`) statt eines Fensters über der Liste - mit Zurück im Browser und Links aus
// dem Dashboard. Die Anmeldungen bleiben ein Fenster, weil sie eine Tabelle und kein Formular sind.
export default function AdminEventsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ types: [], statuses: [], visibilities: [] });
  const [registrationsEvent, setRegistrationsEvent] = useState(null);
  const [creatingRecapId, setCreatingRecapId] = useState(null);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") || "");
  const [visibilityFilter, setVisibilityFilter] = useState(searchParams.get("visibility") || "");
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get("/events?include_drafts=true");
    setList(data);
  }, []);
  useEffect(() => {
    load();
    api.get("/events/meta").then(({ data }) => setMeta(data)).catch(() => {});
  }, [load]);
  useApiInvalidation(load, ["events"]);

  useEffect(() => {
    const nextQuery = searchParams.get("q") || "";
    const nextStatus = searchParams.get("status") || "";
    const nextType = searchParams.get("type") || "";
    const nextVisibility = searchParams.get("visibility") || "";
    if (nextQuery !== query) setQuery(nextQuery);
    if (nextStatus !== statusFilter) setStatusFilter(nextStatus);
    if (nextType !== typeFilter) setTypeFilter(nextType);
    if (nextVisibility !== visibilityFilter) setVisibilityFilter(nextVisibility);
  }, [query, searchParams, statusFilter, typeFilter, visibilityFilter]);

  const updateFilterParams = (patch) => {
    const nextQuery = Object.prototype.hasOwnProperty.call(patch, "q") ? patch.q : query;
    const nextStatus = Object.prototype.hasOwnProperty.call(patch, "status") ? patch.status : statusFilter;
    const nextType = Object.prototype.hasOwnProperty.call(patch, "type") ? patch.type : typeFilter;
    const nextVisibility = Object.prototype.hasOwnProperty.call(patch, "visibility") ? patch.visibility : visibilityFilter;
    setQuery(nextQuery);
    setStatusFilter(nextStatus);
    setTypeFilter(nextType);
    setVisibilityFilter(nextVisibility);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextQuery) params.set("q", nextQuery);
      else params.delete("q");
      if (nextStatus) params.set("status", nextStatus);
      else params.delete("status");
      if (nextType) params.set("type", nextType);
      else params.delete("type");
      if (nextVisibility) params.set("visibility", nextVisibility);
      else params.delete("visibility");
      return params;
    }, { replace: true });
  };

  const remove = async (id) => {
    if (!await confirm({
      title: "Event löschen?",
      description: "Das Event wird aus der öffentlichen Event-Liste entfernt.",
      confirmLabel: "Löschen",
    })) return;
    try { await api.delete(`/events/${id}`); toast.success("Gelöscht."); load(); } catch (err) { toast.error(formatRequestError(err, "Event konnte nicht gelöscht werden.")); }
  };

  const createRecapDraft = async (event) => {
    setCreatingRecapId(event.id);
    try {
      const { data } = await api.post(`/events/${event.id}/recap-draft`);
      toast.success(data.created ? "Rückblick-Entwurf erstellt." : "Rückblick-Entwurf war schon vorhanden.");
      navigate(`/admin/news/${encodeURIComponent(data.post.id)}`);
    } catch (err) {
      toast.error(formatRequestError(err, "Rückblick konnte nicht vorbereitet werden."));
    } finally {
      setCreatingRecapId(null);
    }
  };

  const sortedList = useMemo(() => sortByNearestDate(list), [list]);
  const filteredList = useMemo(() => {
    const needle = normalizeSearch(query);
    return sortedList.filter((event) => {
      if (statusFilter && event.status !== statusFilter) return false;
      if (typeFilter && event.event_type !== typeFilter) return false;
      if (visibilityFilter && event.visibility !== visibilityFilter) return false;
      if (!needle) return true;
      const haystack = normalizeSearch([
        event.name,
        event.slug,
        event.description,
        event.event_type,
        event.status,
        event.visibility,
        event.location,
        event.city,
      ].filter(Boolean).join(" "));
      return haystack.includes(needle);
    });
  }, [query, sortedList, statusFilter, typeFilter, visibilityFilter]);

  const statusOptions = useMemo(() => {
    const rows = (meta.statuses || []).map((item) => [item.k, item.l || item.k]);
    const known = new Set(rows.map(([key]) => key));
    list.forEach((event) => {
      if (event.status && !known.has(event.status)) rows.push([event.status, event.status]);
    });
    return rows;
  }, [list, meta.statuses]);
  const typeOptions = useMemo(() => {
    const rows = (meta.types || []).map((item) => [item.k, item.l || item.k]);
    const known = new Set(rows.map(([key]) => key));
    list.forEach((event) => {
      if (event.event_type && !known.has(event.event_type)) rows.push([event.event_type, event.event_type]);
    });
    return rows;
  }, [list, meta.types]);
  const visibilityOptions = useMemo(() => {
    const rows = (meta.visibilities || []).map((item) => [item.k, item.l || item.k]);
    const known = new Set(rows.map(([key]) => key));
    list.forEach((event) => {
      if (event.visibility && !known.has(event.visibility)) rows.push([event.visibility, event.visibility]);
    });
    return rows;
  }, [list, meta.visibilities]);

  const exportCsv = () => {
    downloadCsv(
      `tls-events-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Name", "Slug", "Typ", "Status", "Sichtbarkeit", "Start", "Ort", "Anmeldungen", "Plaetze"],
      filteredList.map((event) => [
        event.name,
        event.slug,
        eventTypeLabel(event.event_type, meta.types),
        meta.statuses.find((status) => status.k === event.status)?.l || event.status,
        event.visibility,
        formatAdminDate(event.start_date),
        [event.location, event.city].filter(Boolean).join(", "),
        event.registration_summary?.registered_count || 0,
        event.max_participants || "",
      ]),
    );
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9F7AEA]">VEREINS-CMS</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Events</h1>
          <p className="text-sm text-white/60 mt-1">Vereinsabende, LAN-Partys, Grillabende, Messen — alles zentral verwaltet.</p>
        </div>
        <Link to="/admin/events/new" data-testid="events-new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#9F7AEA] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#7C5CE0] transition">
          <Plus className="w-3.5 h-3.5" /> Neues Event
        </Link>
      </div>

      {list.length > 0 && (
        <div className="mb-4 rounded-sm border border-white/10 bg-[#121212] p-3">
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(16rem,1fr)_12rem_12rem_12rem_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <input
                value={query}
                onChange={(event) => updateFilterParams({ q: event.target.value })}
                placeholder="Event, Slug, Ort oder Beschreibung suchen"
                data-testid="events-admin-search"
                className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] py-2 pl-9 pr-3 text-sm focus:border-[#9F7AEA] focus:outline-none"
              />
            </label>
            <select value={statusFilter} onChange={(event) => updateFilterParams({ status: event.target.value })} data-testid="events-admin-status-filter" className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
              <option value="">Alle Status</option>
              {statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={typeFilter} onChange={(event) => updateFilterParams({ type: event.target.value })} data-testid="events-admin-type-filter" className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
              <option value="">Alle Typen</option>
              {typeOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={visibilityFilter} onChange={(event) => updateFilterParams({ visibility: event.target.value })} data-testid="events-admin-visibility-filter" className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
              <option value="">Alle Sichtbarkeiten</option>
              {visibilityOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button
              type="button"
              onClick={exportCsv}
              disabled={filteredList.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-sm border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/65 hover:border-[#9F7AEA]/45 hover:text-white disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
          <div className="mt-2 text-xs text-white/45">{filteredList.length} / {list.length} Events sichtbar</div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
          <Calendar className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <div className="font-heading font-bold">Noch keine Events</div>
        </div>
      ) : (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Typ</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Sichtbar</th>
                  <th className="text-left px-4 py-3">Start</th>
                  <th className="text-left px-4 py-3">Ort</th>
                  <th className="text-left px-4 py-3">Anmeldung</th>
                  <th className="text-center px-4 py-3">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredList.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3"><div className="font-bold">{e.name}</div><div className="text-[11px] text-white/50">/{e.slug}</div></td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-[#9F7AEA] font-bold">{eventTypeLabel(e.event_type, meta.types)}</td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-white/70 font-bold">{meta.statuses.find((s) => s.k === e.status)?.l || e.status}</td>
                    <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-white/60">{e.visibility}</td>
                    <td className="px-4 py-3 text-xs text-white/70">{e.start_date ? new Date(e.start_date).toLocaleDateString("de-DE") : "—"}</td>
                    <td className="px-4 py-3 text-xs text-white/55">{e.location || "—"}</td>
                    <td className="px-4 py-3 text-xs text-white/65">
                      {e.has_registration ? (
                        <div>
                          <div className="font-bold text-white">{e.registration_summary?.reserved_seats || 0}{e.max_participants ? `/${e.max_participants}` : ""} Plätze</div>
                          <div className="text-[11px] text-white/40">{e.registration_summary?.registered_count || 0} Anm. · {e.registration_summary?.companion_count || 0} Begleitp.</div>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center space-x-1 whitespace-nowrap">
                      {e.has_registration && (
                        <button onClick={() => setRegistrationsEvent(e)} data-testid={`event-registrations-${e.id}`} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#29B6E8]/40 text-[#29B6E8] hover:bg-[#29B6E8]/10 inline-flex items-center gap-1">
                          <UserCheck className="w-3 h-3" /> Anm.
                        </button>
                      )}
                      <button onClick={() => createRecapDraft(e)} disabled={creatingRecapId === e.id} data-testid={`event-recap-${e.id}`} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#FFD700]/40 text-[#FFD700] hover:bg-[#FFD700]/10 inline-flex items-center gap-1 disabled:opacity-50">
                        <FileText className="w-3 h-3" /> {creatingRecapId === e.id ? "..." : "Rückblick"}
                      </button>
                      <Link to={`/admin/events/${e.id}`} data-testid={`event-edit-${e.id}`} className="inline-flex text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#9F7AEA]/40 text-[#9F7AEA] hover:bg-[#9F7AEA]/10">Bearbeiten</Link>
                      <button onClick={() => remove(e.id)} data-testid={`event-delete-${e.id}`} className="text-xs font-bold uppercase px-3 py-1 rounded-sm border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 inline-flex items-center"><Trash2 className="w-3 h-3" /></button>
                    </td>
                  </tr>
                ))}
                {filteredList.length === 0 && (
                  <tr>
                    <td colSpan="8" className="px-4 py-10 text-center text-sm text-white/40">Keine Events für diesen Filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {registrationsEvent && <EventRegistrationsModal event={registrationsEvent} onClose={() => setRegistrationsEvent(null)} onChanged={load} />}
    </AdminLayout>
  );
}

const EVENT_REGISTRATION_STATUSES = [
  ["registered", "Angemeldet"],
  ["waitlist", "Warteliste"],
  ["checked_in", "Eingecheckt"],
  ["no_show", "Nicht erschienen"],
  ["cancelled", "Storniert"],
];

function EventRegistrationsModal({ event, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: next } = await api.get(`/events/${event.id}/registrations`);
      setData(next);
    } catch (err) {
      toast.error(formatRequestError(err, "Anmeldungen konnten nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (registration, status) => {
    try {
      await api.patch(`/events/${event.id}/registrations/${registration.id}`, { status });
      await load();
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Anmeldung konnte nicht aktualisiert werden."));
    }
  };

  const summary = data?.summary || event.registration_summary || {};
  const registrations = data?.registrations || [];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <div className="text-[11px] uppercase tracking-widest font-bold text-[#29B6E8]">Event-Anmeldungen</div>
            <h2 className="font-heading font-black uppercase mt-1">{event.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          <div className="grid sm:grid-cols-4 gap-3">
            <Stat label="Reservierte Plätze" value={`${summary.reserved_seats || 0}${summary.max_participants ? `/${summary.max_participants}` : ""}`} />
            <Stat label="Anmeldungen" value={summary.registered_count || 0} />
            <Stat label="Begleitpersonen" value={summary.companion_count || 0} />
            <Stat label="Warteliste" value={summary.waitlist_count || 0} />
          </div>
          <div className="border border-white/10 rounded-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                  <tr>
                    <th className="text-left px-4 py-3">Person</th>
                    <th className="text-left px-4 py-3">Plätze</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Notiz</th>
                    <th className="text-left px-4 py-3">Angelegt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {registrations.map((registration) => (
                    <tr key={registration.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{registration.display_name || "Unbekannt"}</div>
                        <div className="text-xs text-white/40">{registration.email || registration.user_id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{registration.seat_count || 1}</div>
                        {!!registration.companion_count && <div className="text-xs text-white/40">+{registration.companion_count} Begleitp.</div>}
                      </td>
                      <td className="px-4 py-3">
                        <select value={registration.status || "registered"} onChange={(e) => updateStatus(registration, e.target.value)} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs">
                          {EVENT_REGISTRATION_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-white/55 max-w-xs truncate">{registration.note || "—"}</td>
                      <td className="px-4 py-3 text-xs text-white/45">{registration.created_at ? new Date(registration.created_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                    </tr>
                  ))}
                  {!loading && registrations.length === 0 && (
                    <tr><td colSpan="5" className="py-10 text-center text-white/40">Noch keine Anmeldungen</td></tr>
                  )}
                  {loading && (
                    <tr><td colSpan="5" className="p-3"><SkeletonLines lines={3} label="Lade Anmeldungen" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
      <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
      <div className="mt-1 font-heading text-2xl font-black">{value}</div>
    </div>
  );
}
