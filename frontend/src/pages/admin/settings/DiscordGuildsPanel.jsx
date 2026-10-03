import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Crown, ExternalLink, Link2, RefreshCw, Send, Server, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";

// Server-Verzeichnis (#624, Discord VI): ein Bot, mehrere Server. Der Hauptserver bekommt alle Meldungen wie bisher;
// weitere Server (etwa je Spiel) erscheinen, sobald der Bot dort ist - ausgeschaltet, bis du sie einschaltest. Je
// Server: Rolle, Ein/Aus, Einladungslink, Notiz, Gesundheitsprüfung in Worten und eine Testnachricht.

// Ziele, die es auf jedem Server gibt (#625); Vorstand, Betrieb, Test und Mitglieder nur am Hauptserver.
export const SUB_TARGETS = [
  { key: "community", label: "Community" },
  { key: "news", label: "News" },
  { key: "events", label: "Events und Turniere" },
];

/** Kanalwahl eines Unterservers - die Liste kommt vom Bot (offline der zuletzt gesehene Stand). */
function GuildChannels({ guild, onSave, busy }) {
  const [list, setList] = useState(null);
  const [draft, setDraft] = useState(() => ({ ...(guild.channels || {}) }));
  useEffect(() => {
    let alive = true;
    api.get(`/settings/discord/guilds/${guild.guild_id}/channels`).then(({ data }) => alive && setList(data || { channels: [] })).catch(() => alive && setList({ channels: [] }));
    return () => { alive = false; };
  }, [guild.guild_id]);
  const channels = list?.channels || [];
  const changed = SUB_TARGETS.some((target) => (draft[target.key] || "") !== ((guild.channels || {})[target.key] || ""));
  return (
    <div className="space-y-2" data-testid={`discord-guild-${guild.guild_id}-channels`}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">Kanäle auf diesem Server</div>
      <div className="grid sm:grid-cols-3 gap-2">
        {SUB_TARGETS.map((target) => (
          <label key={target.key} className="text-xs text-white/60 space-y-1">
            <span>{target.label}</span>
            <select value={draft[target.key] || ""} onChange={(event) => setDraft((current) => ({ ...current, [target.key]: event.target.value }))}
              data-testid={`discord-guild-${guild.guild_id}-channel-${target.key}`} className="w-full bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm text-sm">
              <option value="">{target.key === "community" ? "– kein Kanal (nichts kommt an) –" : "– kein eigener (geht an Community) –"}</option>
              {(draft[target.key] && !channels.some((channel) => channel.id === draft[target.key]) ? [{ id: draft[target.key], name: `Kanal-ID ${draft[target.key]}`, can_send: true }] : [])
                .concat(channels).map((channel) => (
                  <option key={channel.id} value={channel.id} disabled={!channel.can_send}>#{channel.name}{channel.can_send ? "" : " – Bot darf hier nicht schreiben"}</option>
                ))}
            </select>
          </label>
        ))}
      </div>
      {list && !list.ok && list.text ? <div className="text-xs text-white/40">{list.text}</div> : null}
      <p className="text-[11px] text-white/40">Vorstand, Betrieb, Test und Mitglieder gibt es nur am Hauptserver – hier kommt nie etwas Privates an.</p>
      {changed && (
        <button type="button" onClick={() => onSave(Object.fromEntries(SUB_TARGETS.map((target) => [target.key, draft[target.key] || ""])))} disabled={busy}
          data-testid={`discord-guild-${guild.guild_id}-channels-save`} className="px-3 py-1.5 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">
          Kanäle speichern
        </button>
      )}
    </div>
  );
}

export function guildStatusText(guild) {
  if (guild.left_at) return "Bot nicht mehr auf dem Server";
  if (guild.role === "main") return "Hauptserver · an";
  return guild.enabled ? "Unterserver · an" : "Unterserver · aus";
}

function GuildIcon({ guild }) {
  if (guild.icon_url) return <img src={guild.icon_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />;
  const letters = String(guild.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return <span className="w-10 h-10 rounded-full bg-[#5865F2]/20 text-[#b8c0ff] text-xs font-bold flex items-center justify-center shrink-0">{letters || "?"}</span>;
}

export function DiscordGuildsPanel() {
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState({});
  const [health, setHealth] = useState({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/settings/discord/guilds");
      setData(result || { guilds: [] });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (key, action) => {
    if (busy) return null;
    setBusy(key);
    try {
      return await action();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return null;
    } finally {
      setBusy("");
    }
  };
  const patch = (guild, body, message) => run(`patch-${guild.guild_id}`, async () => {
    await api.patch(`/settings/discord/guilds/${guild.guild_id}`, body);
    toast.success(message);
    await load();
  });
  const makeMain = async (guild) => {
    const ok = await confirm({ title: "Zum Hauptserver machen?", tone: "info", confirmLabel: "Hauptserver",
      description: `„${guild.name}“ wird der Hauptserver; der bisherige wird ein Unterserver. Seine Kanäle für Community, News und Events werden die „Kanäle je Zweck“; Vorstand, Betrieb, Test und Mitglieder wählst du danach neu.` });
    if (ok) await patch(guild, { role: "main" }, `„${guild.name}“ ist jetzt der Hauptserver – Vorstand, Betrieb, Test und Mitglieder unter „Kanäle je Zweck“ neu wählen.`);
  };
  const check = (guild) => run(`health-${guild.guild_id}`, async () => {
    const { data: result } = await api.post(`/settings/discord/guilds/${guild.guild_id}/health`);
    setHealth((current) => ({ ...current, [guild.guild_id]: result }));
  });
  const invite = (guild) => run(`invite-${guild.guild_id}`, async () => {
    const { data: result } = await api.post(`/settings/discord/guilds/${guild.guild_id}/invite`);
    if (result?.ok) toast.success("Einladungslink erzeugt.");
    else toast.error(`Kein Link: ${result?.error || result?.reason || "unbekannt"}`);
    await load();
  });
  const test = async (guild) => {
    let body = {};
    if (guild.role !== "main") {
      const ok = await confirm({ title: "Testnachricht senden?", tone: "info", confirmLabel: "Senden",
        description: `Die Testnachricht geht in den Systemkanal von „${guild.name}“ – den sehen alle auf diesem Server.` });
      if (!ok) return;
      body = { confirm: true };
    }
    await run(`test-${guild.guild_id}`, async () => {
      const { data: result } = await api.post(`/settings/discord/guilds/${guild.guild_id}/test`, body);
      if (result?.ok) toast.success(guild.role === "main" ? "Testnachricht im Testkanal." : "Testnachricht im Systemkanal.");
      else toast.error(`Nicht gesendet: ${result?.error || result?.reason || "unbekannt"}`);
    });
  };

  if (!data) return null;
  const guilds = data.guilds || [];
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="discord-guilds">
      <div>
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><Server className="w-4 h-4 text-[#5865F2]" /> Server</div>
        <p className="mt-1 text-xs text-white/50">
          Ein Bot, mehrere Server: Der Hauptserver bekommt alle Meldungen wie bisher. Weitere Server – etwa je Spiel – erscheinen hier, sobald der Bot
          dort ist, und bleiben aus, bis du sie einschaltest. Es gibt immer genau einen Hauptserver.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="discord-guilds-invite-bot">
        {data.bot_invite_url ? (
          <a href={data.bot_invite_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold uppercase tracking-wider rounded-sm">
            <ExternalLink className="w-3.5 h-3.5" /> Bot auf einen weiteren Server holen
          </a>
        ) : (
          <span className="text-white/45">Der Link, mit dem du den Bot auf einen weiteren Server holst, erscheint, sobald der Bot einmal verbunden war.</span>
        )}
        {!data.connected && <span className="text-[#FFD700]">Der Bot ist gerade nicht verbunden – die Liste zeigt den zuletzt gesehenen Stand.</span>}
      </div>
      {guilds.length === 0 ? (
        <div className="text-xs text-white/45" data-testid="discord-guilds-empty">Noch kein Server bekannt – sobald der Bot verbunden ist, steht sein Server hier.</div>
      ) : (
        <div className="space-y-3">
          {guilds.map((guild) => {
            const report = health[guild.guild_id];
            const missing = guild.missing_permissions || [];
            const note = notes[guild.guild_id] ?? (guild.note || "");
            return (
              <div key={guild.guild_id} className={`border rounded-sm p-3 space-y-3 ${guild.role === "main" ? "border-[#5865F2]/45" : "border-white/10"} ${guild.left_at ? "opacity-60" : ""}`}
                data-testid={`discord-guild-${guild.guild_id}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <GuildIcon guild={guild} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold inline-flex items-center gap-2 min-w-0">
                      <span className="truncate">{guild.name}</span>
                      {guild.role === "main" && <Crown className="w-3.5 h-3.5 text-[#FFD700] shrink-0" aria-label="Hauptserver" />}
                    </div>
                    <div className="text-xs text-white/45" data-testid={`discord-guild-${guild.guild_id}-status`}>
                      {guildStatusText(guild)}{guild.member_count != null ? ` · ${guild.member_count} Mitglieder` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {guild.role !== "main" && !guild.left_at && (
                      <>
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={!!guild.enabled} disabled={!!busy} className="accent-[#00FF88]" data-testid={`discord-guild-${guild.guild_id}-enabled`}
                            onChange={(event) => patch(guild, { enabled: event.target.checked }, event.target.checked ? `„${guild.name}“ ist an.` : `„${guild.name}“ ist aus – dorthin geht nichts mehr.`)} />
                          an
                        </label>
                        <button type="button" onClick={() => makeMain(guild)} disabled={!!busy} data-testid={`discord-guild-${guild.guild_id}-main`}
                          className="px-3 py-1.5 border border-[#FFD700]/40 text-[#FFD700] text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Zum Hauptserver</button>
                      </>
                    )}
                    <button type="button" onClick={() => check(guild)} disabled={!!busy} data-testid={`discord-guild-${guild.guild_id}-health`}
                      className="px-3 py-1.5 border border-white/20 text-white/70 text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
                      <RefreshCw className={`w-3 h-3 ${busy === `health-${guild.guild_id}` ? "animate-spin" : ""}`} /> Prüfen
                    </button>
                    {!guild.left_at && (
                      <button type="button" onClick={() => test(guild)} disabled={!!busy} data-testid={`discord-guild-${guild.guild_id}-test`}
                        className="px-3 py-1.5 border border-[#5865F2]/60 text-[#b8c0ff] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
                        <Send className="w-3 h-3" /> Test
                      </button>
                    )}
                  </div>
                </div>
                {missing.length > 0 && (
                  <div className="text-xs text-[#FFD700]" data-testid={`discord-guild-${guild.guild_id}-missing`}>
                    Dem Bot fehlt: {missing.map((entry) => `„${entry.label}“`).join(", ")} – Discord → Servereinstellungen → Rollen → Rolle des Bots.
                  </div>
                )}
                <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link2 className="w-3.5 h-3.5 text-white/40 shrink-0" />
                    {guild.invite_url
                      ? <a href={guild.invite_url} target="_blank" rel="noreferrer" className="text-[#b8c0ff] hover:text-white truncate" data-testid={`discord-guild-${guild.guild_id}-invite-url`}>{guild.invite_url}</a>
                      : <span className="text-white/40">Kein Einladungslink</span>}
                    {!guild.left_at && (
                      <button type="button" onClick={() => invite(guild)} disabled={!!busy} data-testid={`discord-guild-${guild.guild_id}-invite`}
                        className="shrink-0 px-2 py-1 border border-white/15 text-white/60 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">
                        {guild.invite_url ? "Neu erzeugen" : "Erzeugen"}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input value={note} onChange={(event) => setNotes((current) => ({ ...current, [guild.guild_id]: event.target.value }))} maxLength={300} placeholder="Notiz (z. B. wofür dieser Server ist)"
                      aria-label={`Notiz zu ${guild.name}`} data-testid={`discord-guild-${guild.guild_id}-note`} className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" />
                    {note !== (guild.note || "") && (
                      <button type="button" onClick={() => patch(guild, { note }, "Notiz gespeichert.")} disabled={!!busy} data-testid={`discord-guild-${guild.guild_id}-note-save`}
                        className="px-2 py-1 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Speichern</button>
                    )}
                  </div>
                </div>
                {guild.role !== "main" && !guild.left_at && (
                  <GuildChannels guild={guild} busy={!!busy} onSave={(channels) => patch(guild, { channels }, "Kanäle gespeichert.")} />
                )}
                {report && (
                  <ul className="space-y-1 text-xs" data-testid={`discord-guild-${guild.guild_id}-report`}>
                    {report.checks.map((entry) => (
                      <li key={entry.key} className={`flex items-start gap-2 ${entry.ok ? "text-white/60" : "text-[#FFD700]"}`}>
                        {entry.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF88] shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                        <span>{entry.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
