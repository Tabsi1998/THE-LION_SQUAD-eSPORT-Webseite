/**
 * P0 — Admin Penalty Inbox.
 * Aggregates every penalty issued across the platform with filters.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AlertTriangle, Clock, Flag, ShieldAlert, RefreshCw } from "lucide-react";

const KIND_META = {
  lap_penalty: { icon: Clock, color: "#FF9500", label: "Strafzeit" },
  lap_invalid: { icon: Flag, color: "#FF3B30", label: "Lap Invalid" },
  match_forfeit: { icon: ShieldAlert, color: "#FF3B30", label: "Forfeit" },
  incident: { icon: AlertTriangle, color: "#FFD700", label: "Vorfall" },
};

export default function AdminPenaltiesPage() {
  const [data, setData] = useState({ count: 0, items: [] });
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = filter !== "all" ? `?kind=${filter}` : "";
      const { data } = await api.get(`/admin/penalties${params}`);
      setData(data);
    } catch {/* noop */}
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filter]);

  const counts = (() => {
    const c = { all: data.items.length, lap_penalty: 0, lap_invalid: 0, match_forfeit: 0, incident: 0 };
    data.items.forEach((i) => { c[i.kind] = (c[i.kind] || 0) + 1; });
    return c;
  })();

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FF3B30]">P0 — Transparenz</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Strafen-Inbox</h1>
      <p className="mt-2 text-white/55 text-sm max-w-2xl">
        Alle Strafzeiten, ungültigen Runden, Forfeits und Vorfälle — sortiert nach Datum. Spieler sehen ihre eigenen Einträge unter „Meine Strafen".
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {[
          ["all", "Alle"],
          ["lap_penalty", "Strafzeit"],
          ["lap_invalid", "Lap Invalid"],
          ["match_forfeit", "Forfeit"],
          ["incident", "Vorfall"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            data-testid={`pen-filter-${k}`}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm border ${
              filter === k
                ? "bg-[#FF3B30] text-white border-[#FF3B30]"
                : "border-white/10 text-white/60 hover:text-white hover:border-white/20"
            }`}
          >
            {label} <span className="opacity-60">{counts[k] || 0}</span>
          </button>
        ))}
        <button
          onClick={load}
          data-testid="pen-refresh"
          className="ml-auto px-3 py-1.5 border border-white/10 hover:bg-white/5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-2"
        >
          <RefreshCw className="w-3 h-3" /> Neu laden
        </button>
      </div>

      <div className="mt-6 space-y-3" data-testid="pen-list">
        {loading ? (
          <div className="text-white/40">Lade…</div>
        ) : data.items.length === 0 ? (
          <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/45">
            Keine Strafen für diesen Filter.
          </div>
        ) : (
          data.items.map((p) => <Row key={p.ref_id + p.kind} p={p} />)
        )}
      </div>
    </AdminLayout>
  );
}

function Row({ p }) {
  const meta = KIND_META[p.kind] || KIND_META.incident;
  const Icon = meta.icon;
  const date = p.issued_at ? new Date(p.issued_at).toLocaleString("de-DE", {
    dateStyle: "short", timeStyle: "short",
  }) : "—";
  return (
    <div
      data-testid={`pen-row-${p.ref_id}`}
      className="border border-white/10 bg-[#121212] rounded-sm p-4 grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-4 items-start"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="shrink-0 w-8 h-8 rounded-sm flex items-center justify-center"
          style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          {p.user_username ? (
            <Link to={`/u/${p.user_username}`} className="font-bold hover:text-[#29B6E8] truncate block">
              {p.user_display_name || p.user_username}
            </Link>
          ) : (
            <span className="font-bold">—</span>
          )}
          <div className="text-[10px] uppercase tracking-widest" style={{ color: meta.color }}>{meta.label}</div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-sm text-white/85 italic">„{p.reason}"</div>
        <div className="text-[11px] text-white/45 mt-1">
          {p.context_url ? (
            <Link to={p.context_url} className="hover:underline">{p.context_title}</Link>
          ) : p.context_title}
          {p.context_subtitle && <span> · {p.context_subtitle}</span>}
        </div>
      </div>
      <div className="text-right text-[11px] text-white/45 whitespace-nowrap">
        <div>{date}</div>
        <div>von {p.issued_by_name}</div>
      </div>
    </div>
  );
}
