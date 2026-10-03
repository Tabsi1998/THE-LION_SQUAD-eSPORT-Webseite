import { MessageCircle, Volume2 } from "lucide-react";

// Discord auf der Website (#581): aus dem Server-Widget nur Zahlen. Die Startseite zeigt eine schmale Leiste
// („42 online · 5 im Voice“ und „Beitreten“), der Mitgliederbereich je belegtem Sprachkanal Name und Zahl.
// Namen von Personen gibt es hier nie - der Server verwirft sie schon beim Abruf.

export function discordSummary(discord) {
  if (!discord?.available) return "";
  const online = Number(discord.online) || 0;
  const voice = Number(discord.in_voice) || 0;
  return voice > 0 ? `${online} online · ${voice} im Voice` : `${online} online`;
}

/** Die Leiste auf der Startseite - ohne Widget gar nichts. */
export function DiscordPulse({ discord }) {
  if (!discord?.available) return null;
  return (
    <section className="border-b border-white/10 bg-[#5865F2]/[0.06]" data-testid="home-discord">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-[#b8c0ff]">
          <MessageCircle className="w-4 h-4" aria-hidden="true" /> Discord
        </span>
        <span className="inline-flex items-center gap-2 text-sm text-white/80" data-testid="home-discord-summary">
          <span className="w-2 h-2 rounded-full bg-[#23A55A] animate-pulse" aria-hidden="true" />
          {discordSummary(discord)}
        </span>
        {discord.invite ? (
          <a href={discord.invite} target="_blank" rel="noreferrer" data-testid="home-discord-join"
            className="sm:ml-auto inline-flex items-center gap-2 px-3 py-1.5 bg-[#5865F2] hover:bg-[#4752C4] text-white text-[11px] font-bold uppercase tracking-wider rounded-sm transition">
            Beitreten
          </a>
        ) : null}
      </div>
    </section>
  );
}

/** „Discord jetzt“ im Mitgliederbereich: die Summe und je belegtem Sprachkanal eine Zeile. */
export function DiscordVoice({ data }) {
  if (!data?.available) return null;
  const channels = Array.isArray(data.voice) ? data.voice : [];
  return (
    <div className="space-y-2" data-testid="member-area-discord-voice">
      <div className="text-sm text-white/70" data-testid="member-area-discord-summary">{discordSummary(data)}</div>
      {channels.length ? channels.map((channel) => (
        <div key={channel.name} className="flex items-center justify-between gap-3 border-l-2 border-[#5865F2]/50 pl-3 text-sm">
          <span className="inline-flex items-center gap-2 min-w-0"><Volume2 className="w-3.5 h-3.5 text-[#5865F2] shrink-0" aria-hidden="true" /><span className="truncate">{channel.name}</span></span>
          <span className="font-bold tabular-nums text-white">{channel.count}</span>
        </div>
      )) : <div className="text-xs text-white/40">Gerade ist niemand in einem Sprachkanal.</div>}
      {data.invite ? <a href={data.invite} target="_blank" rel="noreferrer" className="inline-block text-[11px] font-bold uppercase tracking-widest text-[#B8C0FF] hover:text-white">Discord öffnen →</a> : null}
    </div>
  );
}
