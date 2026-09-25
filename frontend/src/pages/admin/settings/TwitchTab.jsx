import { Eye, Radio, RefreshCw } from "lucide-react";
import { BrandField, SystemCard } from "./fields";

// Twitch-Reiter der Einstellungen. Seit #310 sagt er, ob die Abfrage wirklich
// läuft, und je Kanal, ob er auf die Startseite käme - und woran es sonst liegt.
// Vorher stand hier „Credentials gespeichert“, auch wenn Twitch sie ablehnte.

export function apiCard(status) {
  if (!status?.configured) return { ok: false, detail: "Client-ID oder Secret fehlt" };
  if (status.client_secret_readable === false) {
    return { ok: false, detail: "Credentials gespeichert", problem: "Das Secret lässt sich nicht entschlüsseln – neu eintragen und speichern." };
  }
  if (!status.enabled) return { ok: false, detail: "Live-Erkennung ist ausgeschaltet" };
  return { ok: true, detail: "Credentials gespeichert" };
}

export function pollCard(status) {
  const poll = status?.poll;
  if (!poll?.last_run_at) return { ok: false, detail: "Noch kein Lauf. Die Abfrage läuft alle 90 Sekunden, sobald Zugangsdaten gespeichert sind." };
  const when = new Date(poll.last_run_at).toLocaleString("de-DE");
  if (poll.ok) return { ok: true, detail: `${when}: ${poll.live || 0} live von ${poll.checked || 0} Kanälen` };
  return { ok: false, detail: when, problem: `${poll.reason_text || poll.reason}${poll.detail ? ` (${poll.detail})` : ""}` };
}

export function TwitchTab({ brand, setBrandField, status, saving, refreshing, onSave, onRefresh, onClearSecret }) {
  const api = apiCard(status);
  const poll = pollCard(status);
  const channels = status?.channels || [];
  return (
    <div className="max-w-4xl space-y-4">
      {!status?.configured && (
        <div className="flex items-start gap-3 border border-[#9146FF]/30 bg-[#9146FF]/10 rounded-sm p-4">
          <Radio className="w-5 h-5 text-[#9146FF] shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-bold text-[#b88cff] uppercase tracking-wider text-xs">Twitch Helix noch nicht aktiv</div>
            <p className="text-white/70 mt-1">Für Live-Erkennung, Streamer-Achievements und den Live-Slider brauchst du Client-ID und Client-Secret aus einer Twitch Developer App.</p>
          </div>
        </div>
      )}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-heading font-bold uppercase">Live-Erkennung</div>
              <p className="mt-1 text-xs text-white/45">Prüft verknüpfte Twitch-Kanäle, füllt /streams/live und wertet Streamer-Achievements aus.</p>
            </div>
            <label className="flex items-center gap-2 text-sm whitespace-nowrap">
              <input type="checkbox" checked={brand.twitch_live_detection !== false} onChange={(e) => setBrandField("twitch_live_detection", e.target.checked)} className="accent-[#9146FF]" data-testid="twitch-live-detection" />
              <span>Aktiv</span>
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-3">
            <div>
              <div className="font-heading font-bold uppercase text-sm">Clips auf der Startseite</div>
              <p className="mt-1 text-xs text-white/45">Stündlich die meistgesehenen Clips des Vereinskanals aus den letzten 30 Tagen, bis zu sechs als Kachel; der Player lädt erst nach Zustimmung zu externen Medien.</p>
            </div>
            <label className="flex items-center gap-2 text-sm whitespace-nowrap">
              <input type="checkbox" checked={brand.twitch_clips_enabled === true} onChange={(e) => setBrandField("twitch_clips_enabled", e.target.checked)} className="accent-[#9146FF]" data-testid="twitch-clips-enabled" />
              <span>Aktiv</span>
            </label>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <BrandField label="TLS Twitch Channel" value={brand.twitch_channel} onChange={(v) => setBrandField("twitch_channel", v)} testId="twitch-channel" />
            <BrandField label="Twitch Client ID" value={brand.twitch_client_id} onChange={(v) => setBrandField("twitch_client_id", v)} testId="twitch-client-id" />
          </div>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">
              Twitch Client Secret {brand.twitch_client_secret_masked && <span className="text-white/40 normal-case">(aktuell gespeichert)</span>}
            </div>
            <input type="password" value={brand.twitch_client_secret || ""} onChange={(e) => setBrandField("twitch_client_secret", e.target.value)} data-testid="twitch-client-secret" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder={brand.twitch_client_secret_masked ? "Leer lassen, um Secret beizubehalten" : "Client Secret eintragen"} />
            <p className="mt-1 text-xs text-white/40">Das Secret wird beim Laden nicht mehr im Klartext zurückgegeben.</p>
            {brand.twitch_client_secret_masked && <button type="button" onClick={onClearSecret} className="mt-2 text-[10px] uppercase font-bold text-[#FF6B6B]">Gespeichertes Secret entfernen</button>}
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <button onClick={onSave} disabled={saving} data-testid="twitch-save" className="px-5 py-2 bg-[#9146FF] text-white font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{saving ? "Speichere..." : "Speichern"}</button>
            <button onClick={onRefresh} disabled={refreshing || !status?.configured || brand.twitch_live_detection === false} data-testid="twitch-refresh" className="px-4 py-2 border border-[#9146FF]/70 text-[#b88cff] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-40">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Jetzt prüfen
            </button>
          </div>
        </div>
        <div className="grid gap-3">
          <SystemCard title="Twitch API" ok={api.ok} detail={api.detail} problem={api.problem} testId="twitch-card-api" />
          <SystemCard title="Letzte Abfrage" ok={poll.ok} detail={poll.detail} problem={poll.problem} testId="twitch-card-poll" />
          <SystemCard title="Kanäle" ok={(status?.channels_visible || 0) > 0} detail={`${status?.checked_users || 0} Accounts mit Twitch-Feld, ${status?.channels_visible || 0} davon kämen auf die Startseite`} testId="twitch-card-channels" />
          <SystemCard title="Live" ok={(status?.live_count || 0) > 0} detail={`${status?.live_count || 0} Stream(s) aktuell live`} />
          <SystemCard title="Clips" ok={Boolean(status?.clips?.enabled) && !status?.clips?.error} detail={status?.clips?.error || (status?.clips?.enabled ? `${status?.clips?.count || 0} Clips abgelegt${status?.clips?.fetched_at ? `, zuletzt ${new Date(status.clips.fetched_at).toLocaleString("de-DE")}` : ""}` : "aus – Schalter oben")} problem={status?.clips?.error ? "error" : undefined} testId="twitch-card-clips" />
        </div>
      </div>
      {status?.live_streams?.length > 0 && (
        <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 font-heading font-bold uppercase">Aktuell live</div>
          <div className="divide-y divide-white/5">
            {status.live_streams.map((stream) => (
              <a key={stream.stream_id || stream.user_id} href={stream.stream_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5">
                <Radio className="w-4 h-4 text-[#FF3B30] animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate">{stream.display_name || stream.username || stream.twitch_login}</div>
                  <div className="text-xs text-white/45 truncate">{stream.title || "Stream läuft"}{stream.game_name ? ` · ${stream.game_name}` : ""}</div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-white/60"><Eye className="w-3.5 h-3.5" /> {stream.viewer_count || 0}</span>
              </a>
            ))}
          </div>
        </div>
      )}
      {channels.length > 0 && (
        <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden" data-testid="twitch-channels">
          <div className="px-4 py-3 border-b border-white/5">
            <div className="font-heading font-bold uppercase">Kanäle und Startseite</div>
            <p className="mt-1 text-xs text-white/45">
              Auf die Startseite kommen nur aktive Vereinsmitglieder, deren Mitgliederprofil mit dem Plattform-Konto verknüpft ist.
              {status?.channels_detailed === false && " Den genauen Grund sieht die Vereinsverwaltung."}
            </p>
          </div>
          <div className="divide-y divide-white/5">
            {channels.map((channel) => (
              <div key={channel.user_id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-3" data-testid={`twitch-channel-${channel.username}`}>
                <div className="min-w-0 sm:w-56">
                  <div className="font-bold truncate">{channel.display_name || channel.username}</div>
                  <div className="text-xs text-white/45 truncate">twitch.tv/{channel.twitch_login}{channel.is_live ? " · live" : ""}</div>
                </div>
                <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${channel.homepage_visible ? "text-[#00FF88]" : "text-[#FFD700]"}`}>
                  {channel.homepage_visible ? "Startseite" : "nicht sichtbar"}
                </span>
                <div className="text-xs text-white/55 min-w-0 flex-1">{channel.reason_text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
