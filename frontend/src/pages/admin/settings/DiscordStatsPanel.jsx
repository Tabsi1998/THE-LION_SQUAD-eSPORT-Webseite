import { useCallback, useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// Statistik je Server (#631): Nachrichten, aktive verknüpfte Konten, Beitritte und Austritte über 7 und 30 Tage - nur
// Zahlen. Der Bot liest keine Inhalte; „aktive Konten“ sind Mitglieder, die ihr Discord selbst mit der Website
// verknüpft haben. Gäste ohne Konto stecken nur in der Zahl der Nachrichten.

const count = (value) => Number(value || 0).toLocaleString("de-DE");

/** Die Nachrichten der letzten 30 Tage als Balken - ohne Achsen, zum Vergleichen auf einen Blick. */
export function Sparkline({ series = [], label = "" }) {
  const top = Math.max(1, ...series);
  const width = 4;
  const gap = 1;
  const height = 28;
  return (
    <svg viewBox={`0 0 ${Math.max(1, series.length) * (width + gap)} ${height}`} className="w-40 h-7 shrink-0" role="img" aria-label={label} preserveAspectRatio="none">
      {series.map((value, index) => {
        const bar = value ? Math.max(2, Math.round((value / top) * height)) : 1;
        return <rect key={index} x={index * (width + gap)} y={height - bar} width={width} height={bar} className={value ? "fill-[#5865F2]" : "fill-white/10"} />;
      })}
    </svg>
  );
}

function Figure({ label, week, month, testId }) {
  return (
    <div className="min-w-[7.5rem]">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">{label}</div>
      <div className="mt-0.5 text-sm" data-testid={testId}>
        <span className="font-bold">{count(week)}</span><span className="text-white/45"> in 7 Tagen · </span>
        <span className="font-bold">{count(month)}</span><span className="text-white/45"> in 30</span>
      </div>
    </div>
  );
}

export function DiscordStatsPanel() {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/settings/discord/stats");
      setData(result || null);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return null;
  const servers = Array.isArray(data.servers) ? data.servers : [];
  const total = data.total || {};
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="discord-stats">
      <div>
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><BarChart3 className="w-4 h-4 text-[#5865F2]" /> Statistik je Server</div>
        <p className="mt-1 text-xs text-white/50">
          Wie viel auf den Servern los ist – nur Zahlen, der Bot liest keine Inhalte. „Aktive Konten“ sind Mitglieder, die ihr Discord mit der Website verknüpft haben;
          Gäste ohne Konto stecken nur in der Zahl der Nachrichten. Wer wann aktiv war, wird nach {data.keep_days || 35} Tagen gelöscht.
        </p>
      </div>
      {!data.counting && (
        <div className="border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm p-3 text-xs text-white/70" data-testid="discord-stats-off">
          „Nachrichten zählen“ ist aus (Reiter „Bot &amp; Aktivität“) – Nachrichten und aktive Konten werden nicht gezählt. Beitritte und Austritte zählen trotzdem.
        </div>
      )}
      {!data.since && data.counting && (
        <p className="text-xs text-white/45" data-testid="discord-stats-empty">Noch nichts gezählt – die Zahlen kommen mit der ersten Nachricht, die der Bot sieht.</p>
      )}
      <div className="space-y-2">
        {servers.map((server) => (
          <div key={server.guild_id} className="border border-white/5 rounded-sm px-3 py-3 flex flex-wrap items-center gap-x-6 gap-y-3" data-testid={`discord-stats-server-${server.guild_id}`}>
            <div className="min-w-[10rem] flex-1">
              <div className="font-bold break-words">{server.name}</div>
              <div className="text-xs text-white/45">
                {server.role === "main" ? "Hauptserver" : server.enabled ? "Unterserver" : "Unterserver · ausgeschaltet"}
                {server.member_count != null ? ` · ${count(server.member_count)} Mitglieder` : ""}
              </div>
            </div>
            <Figure label="Nachrichten" week={server.messages?.["7"]} month={server.messages?.["30"]} testId={`discord-stats-messages-${server.guild_id}`} />
            <Figure label="Aktive Konten" week={server.active?.["7"]} month={server.active?.["30"]} testId={`discord-stats-active-${server.guild_id}`} />
            <div className="min-w-[7.5rem]">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">Kommen und Gehen (30 Tage)</div>
              <div className="mt-0.5 text-sm" data-testid={`discord-stats-members-${server.guild_id}`}>
                <span className="font-bold text-[#00FF88]">+{count(server.joins?.["30"])}</span><span className="text-white/45"> · </span>
                <span className="font-bold text-[#FF3B30]">−{count(server.leaves?.["30"])}</span>
              </div>
            </div>
            <Sparkline series={server.series || []} label={`Nachrichten der letzten 30 Tage auf ${server.name}`} />
          </div>
        ))}
        {!servers.length && <p className="text-sm text-white/45">Der Bot ist auf keinem Server.</p>}
      </div>
      {servers.length > 1 && (
        <div className="text-xs text-white/60 border-t border-white/5 pt-3" data-testid="discord-stats-total">
          Alle Server zusammen: <span className="font-bold text-white">{count(total.messages?.["30"])}</span> Nachrichten in 30 Tagen von{" "}
          <span className="font-bold text-white">{count(total.active?.["30"])}</span> aktiven Konten – jedes Konto einmal gezählt, auch wenn es auf mehreren Servern schreibt.
        </div>
      )}
    </div>
  );
}
