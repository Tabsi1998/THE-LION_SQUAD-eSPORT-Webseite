/**
 * P0 — User Penalty Log.
 * Shows every penalty issued against the current user with full reason/context.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { AlertTriangle, Clock, Flag, ShieldAlert, ArrowRight } from "lucide-react";

const KIND_META = {
  lap_penalty: { icon: Clock, color: "#FF9500", label: "Strafzeit" },
  lap_invalid: { icon: Flag, color: "#FF3B30", label: "Runde ungültig" },
  match_forfeit: { icon: ShieldAlert, color: "#FF3B30", label: "Forfeit" },
  incident: { icon: AlertTriangle, color: "#FFD700", label: "Vorfall" },
};

export default function MyPenaltiesPage() {
  useDocumentTitle("Meine Strafen", "Übersicht aller Strafen mit Begründung.");
  const [data, setData] = useState({ count: 0, items: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/penalties/me")
      .then(({ data }) => setData(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["penalties", "matches", "f1"]);

  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Dashboard", to: "/dashboard" }, { label: "Meine Strafen" }]} className="mb-6" />
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FF3B30]">Transparenz</span>
        <h1 className="mt-2 font-heading text-4xl md:text-5xl font-black uppercase">Meine Strafen</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Hier siehst du jede Strafe, ungültige Runde oder Forfeit-Entscheidung gegen dich — inklusive der vollständigen Begründung des Admins. Bei Fragen wende dich an den Vorstand.
        </p>

        <div className="mt-8" data-testid="my-penalties-list">
          {loading ? (
            <div className="text-white/40">Lade…</div>
          ) : data.items.length === 0 ? (
            <div className="border border-dashed border-white/15 rounded-sm p-12 text-center">
              <ShieldAlert className="w-10 h-10 text-[#00FF88] mx-auto mb-3" />
              <div className="font-heading text-xl font-bold uppercase">Saubere Weste</div>
              <p className="mt-2 text-white/60 text-sm">Keine Strafen, keine ungültigen Runden, keine Forfeits — keep it up!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.items.map((p) => <PenaltyCard key={p.ref_id} p={p} />)}
            </div>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

function PenaltyCard({ p }) {
  const meta = KIND_META[p.kind] || KIND_META.incident;
  const Icon = meta.icon;
  const date = p.issued_at ? new Date(p.issued_at).toLocaleString("de-DE", {
    dateStyle: "medium", timeStyle: "short",
  }) : "—";
  return (
    <div
      data-testid={`penalty-card-${p.ref_id}`}
      className="border border-white/10 rounded-sm bg-[#121212] p-5 hover:border-[#FF3B30]/30 transition"
    >
      <div className="flex items-start gap-4">
        <div
          className="shrink-0 w-10 h-10 rounded-sm flex items-center justify-center"
          style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-heading font-black uppercase text-white" style={{ color: meta.color }}>
              {p.label}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">{meta.label}</span>
          </div>
          <div className="mt-1 text-sm text-white/80">
            {p.context_url ? (
              <Link to={p.context_url} className="hover:text-[#29B6E8] inline-flex items-center gap-1">
                {p.context_title}
                {p.context_subtitle && <span className="text-white/50">· {p.context_subtitle}</span>}
                <ArrowRight className="w-3 h-3" />
              </Link>
            ) : (
              <span>
                {p.context_title}
                {p.context_subtitle && <span className="text-white/50"> · {p.context_subtitle}</span>}
              </span>
            )}
          </div>

          <div className="mt-3 border-l-2 pl-3 italic text-white/85" style={{ borderColor: meta.color }}>
            „{p.reason}"
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45">
            <span>Eintrag von: <span className="text-white/70">{p.issued_by_name}</span></span>
            <span>·</span>
            <span>{date}</span>
            {p.raw_time_str && p.raw_time_str !== "—" && (
              <>
                <span>·</span>
                <span>Roh-Zeit: <span className="text-white/70 font-mono">{p.raw_time_str}</span></span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
