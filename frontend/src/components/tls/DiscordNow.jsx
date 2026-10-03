import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { api } from "@/lib/api";

// Discord auf der Website (#581): aus dem Server-Widget nur Zahlen. Der Block „Dabei sein“ im Footer jeder Seite zeigt
// „42 online · 5 im Voice“ neben „Discord beitreten“ (#854 - vorher eine eigene Leiste auf der Startseite), der
// Mitgliederbereich je belegtem Sprachkanal Name und Zahl.
// Namen von Personen gibt es hier nie - der Server verwirft sie schon beim Abruf.

export function discordSummary(discord) {
  if (!discord?.available) return "";
  const online = Number(discord.online) || 0;
  const voice = Number(discord.in_voice) || 0;
  return voice > 0 ? `${online} online · ${voice} im Voice` : `${online} online`;
}

// Einmal je Seitenaufruf-Sitzung geholt und zwei Minuten gemerkt - jede Seite hat den Footer, Discord ändert sich langsam.
const FRESH_MS = 120000;
let cache = { data: null, at: 0, pending: null };

/** Für Tests: den gemerkten Stand vergessen. */
export function resetDiscordNow() {
  cache = { data: null, at: 0, pending: null };
}

/** „Discord jetzt“ aus `/api/home/discord` - null, solange nichts da ist oder bei einem Fehler. */
export function useDiscordNow() {
  const [data, setData] = useState(() => cache.data);
  useEffect(() => {
    let alive = true;
    if (cache.data && Date.now() - cache.at < FRESH_MS) {
      setData(cache.data);
      return undefined;
    }
    if (!cache.pending) {
      cache.pending = api.get("/home/discord")
        .then((response) => {
          cache = { data: response?.data || null, at: Date.now(), pending: null };
          return cache.data;
        })
        .catch(() => {
          cache.pending = null;
          return null;
        });
    }
    cache.pending.then((value) => {
      if (alive) setData(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** Die Zeile neben „Discord beitreten“: grüner Punkt und die Zahlen - ohne Widget gar nichts. */
export function DiscordLiveLine({ discord, testId = "footer-discord-live" }) {
  if (!discord?.available) return null;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-white/75 whitespace-nowrap" data-testid={testId}>
      <span className="w-2 h-2 rounded-full bg-[#23A55A] animate-pulse" aria-hidden="true" />
      {discordSummary(discord)}
    </span>
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
