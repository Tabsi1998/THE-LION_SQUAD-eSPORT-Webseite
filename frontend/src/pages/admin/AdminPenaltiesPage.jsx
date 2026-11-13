/**
 * P0 — Admin Penalty Inbox.
 * Aggregates every penalty issued across the platform with filters.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { SkeletonList } from "@/components/tls/Skeleton";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { AlertTriangle, Clock, ExternalLink, Flag, Gavel, ShieldAlert, RefreshCw, Undo2 } from "lucide-react";
import { viennaDateTime } from "@/lib/vienna";
import { toast } from "sonner";

const KIND_META = {
  lap_penalty: { icon: Clock, color: "#FF9500", label: "Strafzeit" },
  lap_invalid: { icon: Flag, color: "#FF3B30", label: "Runde ungültig" },
  match_forfeit: { icon: ShieldAlert, color: "#FF3B30", label: "Kampflos verloren" },
  incident: { icon: AlertTriangle, color: "#FFD700", label: "Vorfall" },
  // Strafen der Liga (E.3): verhängt und verwaltet im Reiter „Strafen“ der Season - „Öffnen“ führt dorthin.
  league_sanction: { icon: Gavel, color: "#FF6B60", label: "Strafe der Liga" },
};

export default function AdminPenaltiesPage() {
  const [data, setData] = useState({ count: 0, items: [] });
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter !== "all" ? `?kind=${filter}` : "";
      const { data } = await api.get(`/admin/penalties${params}`);
      setData(data);
    } catch {/* noop */}
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["penalties", "matches", "f1"]);

  // Die Zähler kommen vom Server (#2125): mit aktivem Filter stünde sonst bei den anderen Knöpfen 0.
  const counts = data.counts || {};
  const confirm = useConfirm();
  const prompt = usePrompt();

  // Zurücknehmen (#2130): Strafzeit und „ungültig“ fallen weg, die Zeit zählt wieder. Nach der Veröffentlichung nur mit
  // Begründung - dann gleicht der Server Gewinne und Saisonpunkte an.
  const takeBack = async (p) => {
    const body = { penalty_seconds: 0, is_invalid: false };
    // Eine Runde kann beides tragen - dann fallen auch beide weg, und das soll vorher dastehen.
    const both = p.is_invalid && Number(p.penalty_seconds) > 0;
    const falling = both ? `Die Strafzeit (+${p.penalty_seconds}s) und „ungültig“ fallen weg` : `„${p.label}“ fällt weg`;
    if (p.results_locked) {
      const reason = await prompt({
        title: "Begründung nötig",
        description: `Die Ergebnisse sind veröffentlicht. ${falling}. Das geht nur mit Begründung (mind. 10 Zeichen) - sie steht im Protokoll, Gewinne und Saisonpunkte werden angeglichen.`,
        placeholder: "z. B. Video zeigt: Runde war sauber",
        confirmLabel: "Zurücknehmen",
        required: true,
      });
      const text = typeof reason === "string" ? reason.trim() : "";
      if (!text) return;
      body.change_reason = text;
    } else if (!await confirm({
      title: "Strafe zurücknehmen?",
      description: `${falling}, die Zeit zählt wieder normal. Das steht im Protokoll.`,
      confirmLabel: "Zurücknehmen",
      tone: "info",
    })) return;
    try {
      const { data: saved } = await api.patch(`/f1/times/${p.ref_id}`, body);
      toast.success("Strafe zurückgenommen.");
      if (saved?.resync_warning) toast.warning(saved.resync_warning);
      load();
    } catch (error) {
      toast.error(formatRequestError(error, "Die Strafe ließ sich nicht zurücknehmen."));
    }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FF3B30]">eSports</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Strafen</h1>
      <p className="mt-2 text-white/55 text-sm max-w-2xl">
        Alle Strafzeiten, ungültigen Runden, kampflosen Niederlagen, Vorfälle und Strafen der Liga – sortiert nach Datum. Spieler sehen ihre eigenen Einträge unter „Meine Strafen“.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {[
          ["all", "Alle"],
          ["lap_penalty", "Strafzeit"],
          ["lap_invalid", "Runde ungültig"],
          ["match_forfeit", "Kampflos verloren"],
          ["incident", "Vorfall"],
          ["league_sanction", "Strafe der Liga"],
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
          <SkeletonList rows={4} label="Lade Strafen" />
        ) : data.items.length === 0 ? (
          <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/45">
            Keine Strafen für diesen Filter.
          </div>
        ) : (
          data.items.map((p) => <Row key={p.ref_id + p.kind} p={p} onTakeBack={takeBack} />)
        )}
      </div>
    </AdminLayout>
  );
}

const LAP_KINDS = new Set(["lap_penalty", "lap_invalid"]);

function Row({ p, onTakeBack }) {
  const meta = KIND_META[p.kind] || KIND_META.incident;
  const Icon = meta.icon;
  const date = p.issued_at ? viennaDateTime(p.issued_at, {
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
            <Link to={`/u/${encodeURIComponent(p.user_username)}`} className="font-bold hover:text-[#29B6E8] truncate block">
              {p.user_display_name || p.user_username}
            </Link>
          ) : (
            <span className="font-bold break-words" data-testid={`pen-team-${p.ref_id}`}>{p.team_name || "—"}</span>
          )}
          <div className="text-[10px] uppercase tracking-widest" style={{ color: meta.color }}>{meta.label}</div>
        </div>
      </div>
      <div className="min-w-0">
        {p.kind === "league_sanction" ? <div className="text-sm font-bold text-white" data-testid={`pen-sanction-${p.ref_id}`}>{p.label}{p.sanction?.period ? ` · ${p.sanction.period}` : ""}{p.sanction?.status === "revoked" ? " · widerrufen" : ""}</div> : null}
        <div className="text-sm text-white/85 italic">„{p.reason}"</div>
        <div className="text-[11px] text-white/45 mt-1">
          {p.context_url ? (
            <Link to={p.context_url} className="hover:underline">{p.context_title}</Link>
          ) : p.context_title}
          {p.context_subtitle && <span> · {p.context_subtitle}</span>}
        </div>
      </div>
      <div className="md:text-right text-[11px] text-white/45 whitespace-nowrap">
        <div>{date}</div>
        <div>von {p.issued_by_name}</div>
        <div className="mt-2 flex flex-wrap md:justify-end gap-2">
          {p.admin_url && (
            <Link to={p.admin_url} data-testid={`pen-open-${p.ref_id}`} className="inline-flex items-center gap-1 px-2 py-1 border border-white/15 rounded-sm text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-[#29B6E8] hover:border-[#29B6E8]/50">
              <ExternalLink className="w-3 h-3" aria-hidden="true" /> Öffnen
            </Link>
          )}
          {LAP_KINDS.has(p.kind) && (
            <button type="button" onClick={() => onTakeBack(p)} data-testid={`pen-take-back-${p.ref_id}`} className="inline-flex items-center gap-1 px-2 py-1 border border-white/15 rounded-sm text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-[#FF3B30] hover:border-[#FF3B30]/50">
              <Undo2 className="w-3 h-3" aria-hidden="true" /> Zurücknehmen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
