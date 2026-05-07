import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Calendar, MapPin, Users as UsersIcon, Crown, Lock } from "lucide-react";

const VIS_ICON = { members: Crown, internal: Lock };

export default function EventsPage() {
  useDocumentTitle("Events", "Aktuelle und kommende Events von THE LION SQUAD eSports.");
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ types: [], statuses: [] });
  const [typeFilter, setTypeFilter] = useState("");
  const [tab, setTab] = useState("upcoming"); // upcoming | past

  useEffect(() => { api.get("/events/meta").then(({ data }) => setMeta(data)).catch(() => {}); }, []);

  const load = useCallback(() => {
    const url = tab === "upcoming" ? "/events?upcoming=true" : "/events";
    api.get(url).then(({ data }) => setList(data)).catch(() => {});
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["events"]);

  const filtered = list.filter((e) => {
    if (typeFilter && e.event_type !== typeFilter) return false;
    const phaseState = e.public_phase?.state || e.event_phase?.state || e.status;
    if (tab === "past" && !["completed", "archived", "results_published"].includes(phaseState)) return false;
    return true;
  });
  const filterTypes = (meta.types || []).filter((t) => !meta.primary_types || meta.primary_types.includes(t.k));

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#9F7AEA]">VEREINSEVENTS</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Events</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          LAN-Partys, Grillabende, Vereinsabende, Messen — alles, wo wir gemeinsam abhängen oder den Vereinsspirit feiern.
        </p>

        <div className="mt-8 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex gap-2">
            <button onClick={() => setTab("upcoming")} data-testid="events-tab-upcoming" className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${tab === "upcoming" ? "bg-[#9F7AEA] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}>Kommend</button>
            <button onClick={() => setTab("past")} data-testid="events-tab-past" className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${tab === "past" ? "bg-white/15 text-white" : "border border-white/10 text-white/60 hover:text-white"}`}>Vergangen</button>
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} data-testid="events-type-filter" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            <option value="">Alle Typen</option>
            {filterTypes.map((t) => <option key={t.k} value={t.k}>{t.l}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Calendar className="w-10 h-10 mx-auto opacity-40 mb-3" />
            <div className="font-heading font-bold text-lg">Keine Events</div>
            <div className="text-sm mt-1">{tab === "upcoming" ? "Aktuell sind keine Events geplant. Schau bald wieder vorbei." : "Keine vergangenen Events in dieser Auswahl."}</div>
          </div>
        ) : (
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((e) => <EventCard key={e.id} e={e} meta={meta} />)}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function EventCard({ e, meta }) {
  const VIcon = VIS_ICON[e.visibility];
  const typeLabel = meta.types.find((t) => t.k === e.event_type)?.l || e.event_type;
  return (
    <Link
      to={`/events/${e.slug}`}
      data-testid={`event-card-${e.slug}`}
      className="group border border-white/10 hover:border-[#9F7AEA]/50 rounded-sm bg-[#121212] overflow-hidden flex flex-col transition"
    >
      {e.banner_url ? (
        <div className="aspect-video bg-[#0A0A0A] overflow-hidden">
          <img src={resolveMediaUrl(e.banner_url)} alt="" className="w-full h-full object-contain group-hover:scale-[1.02] transition duration-500" />
        </div>
      ) : (
        <div className="aspect-video bg-gradient-to-br from-[#9F7AEA]/20 via-[#0A0A0A] to-[#0A0A0A] flex items-center justify-center">
          <Calendar className="w-10 h-10 text-[#9F7AEA]/40" />
        </div>
      )}
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 flex-wrap text-[10px] uppercase tracking-widest font-bold">
          <span className="text-[#9F7AEA]">{typeLabel}</span>
          <PhaseBadge phase={e.public_phase || e.event_phase} status={e.status} />
          {VIcon && <VIcon className="w-3 h-3 text-[#FFD700]" />}
        </div>
        <h3 className="mt-2 font-heading font-black text-lg group-hover:text-[#9F7AEA] transition">{e.name}</h3>
        {e.start_date && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/60">
            <Calendar className="w-3 h-3" />
            {new Date(e.start_date).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
          </div>
        )}
        {e.location && (
          <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-white/60">
            <MapPin className="w-3 h-3" /> {e.location}
          </div>
        )}
        {e.max_participants && (
          <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-white/50">
            <UsersIcon className="w-3 h-3" /> max. {e.max_participants}
          </div>
        )}
        {e.description && <p className="mt-3 text-sm text-white/65 line-clamp-2 flex-1">{e.description}</p>}
      </div>
    </Link>
  );
}
