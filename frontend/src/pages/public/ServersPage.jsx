import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Clipboard, ExternalLink, Lock, Map, Server, Shield, Signal, Users } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useAuth } from "@/context/AuthContext";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const statusLabels = { online: "Online", offline: "Offline", maintenance: "Wartung", planned: "Geplant" };
const visibilityLabels = { public: "Öffentlich", community: "Community", members: "Vereinsmitglieder", internal: "Intern" };
const statusClasses = {
  online: "border-[#00FF88]/40 bg-[#00FF88]/10 text-[#00FF88]",
  offline: "border-white/15 bg-white/5 text-white/45",
  maintenance: "border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFD700]",
  planned: "border-[#29B6E8]/40 bg-[#29B6E8]/10 text-[#29B6E8]",
};

function gameName(server) {
  return server.game?.short_name || server.game?.name || server.game_name || "Gameserver";
}

function playerText(server) {
  const current = Number(server.player_count || 0);
  if (server.max_players == null || server.max_players === "") return `${current} online`;
  return `${current}/${server.max_players} online`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

export default function ServersPage() {
  useDocumentTitle("Server", "Öffentliche und geschützte Community-Gameserver von THE LION SQUAD.");
  const { user, isClubMember } = useAuth();
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/game-servers").then(({ data }) => {
      setItems(data.items || []);
      setSummary(data.summary || {});
    }).catch(() => {
      setItems([]);
      setSummary({});
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, user?.id, isClubMember]);
  useApiInvalidation(load, ["game-servers"]);

  const grouped = useMemo(() => ({
    online: items.filter((item) => item.status === "online"),
    other: items.filter((item) => item.status !== "online"),
  }), [items]);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Community</span>
        <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase">Server</h1>
        <p className="mt-4 max-w-3xl text-white/65">
          Unsere Community- und Vereinsserver. Öffentliche Server sind direkt sichtbar, Community-Server nach Login und Vereinsserver nur für aktive Vereinsmitglieder.
        </p>

        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Sichtbare Server" value={loading ? "-" : summary.total || 0} icon={Server} />
          <Stat label="Online" value={loading ? "-" : summary.online || 0} icon={Signal} tone="green" />
          <Stat label="Spieler online" value={loading ? "-" : summary.players_online || 0} icon={Users} />
          <Stat label="Für Mitglieder" value={loading ? "-" : summary.members || 0} icon={Shield} tone="gold" />
        </div>

        {!user && (
          <div className="mt-6 border border-[#29B6E8]/25 bg-[#29B6E8]/10 rounded-sm p-4 text-sm text-white/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <Lock className="w-4 h-4 text-[#29B6E8] mt-0.5 shrink-0" />
              <span>Nach dem Login siehst du zusätzlich Server, die nur für registrierte Community-Accounts freigegeben sind.</span>
            </div>
            <Link to="/login?next=/servers" className="inline-flex justify-center px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-[#29B6E8]/10">
              Einloggen
            </Link>
          </div>
        )}

        {items.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/45">
            <Server className="w-10 h-10 mx-auto mb-4 opacity-40" />
            <div className="font-heading font-bold text-lg">{loading ? "Server werden geladen…" : "Keine Server sichtbar."}</div>
          </div>
        ) : (
          <div className="mt-10 space-y-10">
            {grouped.online.length > 0 && (
              <ServerSection title="Aktuell online" items={grouped.online} />
            )}
            {grouped.other.length > 0 && (
              <ServerSection title="Weitere Server" items={grouped.other} />
            )}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function Stat({ label, value, icon: Icon, tone }) {
  const color = tone === "green" ? "text-[#00FF88]" : tone === "gold" ? "text-[#FFD700]" : "text-[#29B6E8]";
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className={`mt-2 font-display text-3xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function ServerSection({ title, items }) {
  return (
    <section>
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-2xl font-black uppercase">{title}</h2>
        <div className="h-px flex-1 bg-white/10" />
      </div>
      <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((server) => <ServerCard key={server.id} server={server} />)}
      </div>
    </section>
  );
}

function ServerCard({ server }) {
  const status = server.status || "offline";
  const max = Number(server.max_players || 0);
  const current = Number(server.player_count || 0);
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  const iconUrl = server.server_icon_url || server.game?.logo_url;
  const maintenanceText = [
    server.maintenance_note,
    server.maintenance_until ? `bis ${formatDateTime(server.maintenance_until)}` : "",
  ].filter(Boolean).join(" · ");
  const copyAddress = async () => {
    if (!server.address || !navigator.clipboard) return;
    await navigator.clipboard.writeText(server.address).catch(() => null);
    toast.success("Server-Adresse kopiert.");
  };
  return (
    <article className={`relative overflow-hidden border rounded-sm bg-[#111] p-5 min-h-[18rem] flex flex-col ${status === "maintenance" ? "border-[#FFD700]/35" : "border-white/10"}`}>
      {status === "maintenance" && (
        <div className="absolute inset-x-0 top-0 bg-[#FFD700] text-black text-[10px] font-black uppercase tracking-[0.25em] px-4 py-1">
          Baustelle / Wartung{maintenanceText ? ` · ${maintenanceText}` : ""}
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-14 h-14 rounded-sm border border-white/10 bg-black/30 flex items-center justify-center overflow-hidden shrink-0">
            {iconUrl ? <img src={resolveMediaUrl(iconUrl)} alt="" className="w-full h-full object-contain p-2" /> : <Server className="w-6 h-6 text-[#29B6E8]" />}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold truncate">{gameName(server)}</div>
            <h3 className="font-heading text-xl font-black uppercase leading-tight truncate">{server.name}</h3>
          </div>
        </div>
        <span className={`shrink-0 border px-2 py-1 rounded-sm text-[10px] font-black uppercase tracking-widest ${statusClasses[status] || statusClasses.offline}`}>
          {statusLabels[status] || status}
        </span>
      </div>

      {server.description && <p className="mt-4 text-sm text-white/60 line-clamp-3">{server.description}</p>}

      <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
        <Info label="Zugriff" value={visibilityLabels[server.visibility] || server.visibility} />
        <Info label="Spieler" value={playerText(server)} />
        {server.map_name && <Info label="Map" value={server.map_name} />}
        {server.version && <Info label="Version" value={server.version} />}
      </div>

      {max > 0 && (
        <div className="mt-4">
          <div className="h-2 bg-white/10 rounded-sm overflow-hidden">
            <div className="h-full bg-[#29B6E8]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {server.player_names?.length > 0 && (
        <div className="mt-4 text-xs text-white/45">
          Online: <span className="text-white/70">{server.player_names.slice(0, 6).join(", ")}</span>{server.player_names.length > 6 ? " …" : ""}
        </div>
      )}

      <div className="mt-auto pt-5 space-y-2">
        {server.address && (
          <button type="button" onClick={copyAddress} className="w-full text-left font-mono text-xs border border-white/10 bg-black/30 rounded-sm px-3 py-2 text-white/75 break-all hover:border-[#29B6E8]/50 hover:text-white transition inline-flex items-center justify-between gap-3">
            <span>{server.address}</span>
            <Clipboard className="w-3.5 h-3.5 shrink-0 text-[#29B6E8]" />
          </button>
        )}
        {server.password_hint && <div className="text-xs text-[#FFD700]/80">{server.password_hint}</div>}
        <div className="flex gap-2 flex-wrap">
          {server.connect_url && (
            <a href={server.connect_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-[#29B6E8]/10">
              Verbinden <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {server.map_url && (
            <a href={server.map_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 border border-[#FFD700]/45 text-[#FFD700] rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-[#FFD700]/10">
              Karte <Map className="w-3.5 h-3.5" />
            </a>
          )}
          {server.external_status_url && (
            <a href={server.external_status_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/65 rounded-sm text-xs font-bold uppercase tracking-wider hover:text-white">
              Status <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {server.rules_url && (
            <a href={server.rules_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/65 rounded-sm text-xs font-bold uppercase tracking-wider hover:text-white">
              Regeln
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function Info({ label, value }) {
  return (
    <div className="border border-white/10 rounded-sm px-3 py-2 bg-black/20 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-white/35 font-bold">{label}</div>
      <div className="mt-1 text-white/75 truncate">{value || "-"}</div>
    </div>
  );
}
