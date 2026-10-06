import { useCallback, useEffect, useState } from "react";
import { Megaphone, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { DiscordMessagePreview } from "@/components/tls/DiscordMessagePreview";

// Weitergabe zwischen den Servern (#631) - der Bot kopiert nichts:
// 1. Ankündigungen folgen: Discord spiegelt, was im Ankündigungskanal eines Unterservers veröffentlicht wird, in einen
//    Sammelkanal am Hauptserver. Hier wird das eingerichtet und der Stand gezeigt, wie Discord ihn meldet.
// 2. Mitteilung verteilen: ein Text an mehrere Server - erst die Vorschau, dann das Senden. Im Discord geht dasselbe
//    mit /verteilen (Turnierleitung und Vorstand).

const STATE_LABEL = {
  followed: "eingerichtet", ready: "bereit", no_collector: "wartet", no_news_channel: "kein Ankündigungskanal",
  no_webhook_right: "Recht fehlt", offline: "Bot offline", unknown: "unklar",
};
const STATE_TONE = { followed: "border-[#00FF88]/40 text-[#00FF88]", ready: "border-[#FFD700]/40 text-[#FFD700]" };
const BOX = "border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4";
const FIELD = "w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm";
const EMBED_COLOR = 0x29B6E8;

export function channelLabel(row) {
  return `#${row.name}${row.category ? ` · ${row.category}` : ""}`;
}

export function FollowBox() {
  const [data, setData] = useState(null);
  const [sources, setSources] = useState({});
  const [busy, setBusy] = useState(false);

  const take = useCallback((result) => {
    setData(result || null);
    setSources((current) => {
      const next = { ...current };
      for (const server of result?.servers || []) {
        const known = (server.news_channels || []).some((row) => row.id === next[server.guild_id]);
        if (!known) next[server.guild_id] = server.source_channel_id || server.news_channels?.[0]?.id || "";
      }
      return next;
    });
  }, []);
  const load = useCallback(async () => {
    try {
      take((await api.get("/settings/discord/forward")).data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, [take]);
  useEffect(() => { load(); }, [load]);

  const chooseCollector = async (channelId) => {
    if (busy) return;
    setBusy(true);
    try {
      take((await api.put("/settings/discord/forward", { channel_id: channelId })).data);
      toast.success(channelId ? "Sammelkanal gespeichert." : "Kein Sammelkanal mehr gewählt.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const follow = async (server) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: result } = await api.post(`/settings/discord/forward/${server.guild_id}`, { source_channel_id: sources[server.guild_id] });
      if (result?.ok) toast.success(`Ankündigungen von „${server.name}“ erscheinen jetzt im Sammelkanal.`);
      else toast.error(result?.error || "Das Folgen hat nicht geklappt.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const servers = Array.isArray(data.servers) ? data.servers : [];
  const collector = data.collector || {};
  return (
    <div className={BOX} data-testid="discord-follow">
      <div>
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><Megaphone className="w-4 h-4 text-[#5865F2]" /> Ankündigungen folgen</div>
        <p className="mt-1 text-xs text-white/50">
          Was auf einem Unterserver im Ankündigungskanal veröffentlicht wird, erscheint von selbst in einem Sammelkanal am Hauptserver – mit Herkunft.
          Das macht Discord selbst („Folgen“); der Bot kopiert und liest nichts. Hier richtest du es ein.
        </p>
      </div>
      <label className="block text-sm">
        <span className="block text-xs text-white/55 mb-1">Sammelkanal am Hauptserver</span>
        <select value={collector.channel_id || ""} disabled={busy} onChange={(e) => chooseCollector(e.target.value)} className={FIELD} data-testid="discord-follow-collector">
          <option value="">– keiner –</option>
          {channels.map((row) => <option key={row.id} value={row.id}>{channelLabel(row)}</option>)}
          {collector.channel_id && !channels.some((row) => row.id === collector.channel_id) && <option value={collector.channel_id}>Kanal {collector.channel_id}</option>}
        </select>
      </label>
      {collector.channel_id && collector.can_webhooks === false && (
        <div className="border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm p-3 text-xs text-white/70" data-testid="discord-follow-right">
          In diesem Kanal fehlt dem Bot „Webhooks verwalten“ – er kann dann weder nachsehen noch einrichten. Kanal bearbeiten → Berechtigungen → Rolle des Bots → „Webhooks verwalten“.
        </div>
      )}
      {!data.online && <p className="text-xs text-[#FFD700]" data-testid="discord-follow-offline">Der Bot ist nicht verbunden – der Stand kommt, sobald er online ist.</p>}
      <div className="space-y-2">
        {servers.map((server) => (
          <div key={server.guild_id} className="border border-white/5 rounded-sm px-3 py-3 space-y-2" data-testid={`discord-follow-server-${server.guild_id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold break-words">{server.name}</span>
              <span className={`px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest ${STATE_TONE[server.state] || "border-white/15 text-white/55"}`}
                data-testid={`discord-follow-state-${server.guild_id}`}>
                {STATE_LABEL[server.state] || server.state}
              </span>
            </div>
            <p className="text-xs text-white/55">{server.text}</p>
            {(server.news_channels || []).length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <select value={sources[server.guild_id] || ""} disabled={busy || server.state === "followed"} aria-label={`Ankündigungskanal von ${server.name}`}
                  onChange={(e) => setSources((current) => ({ ...current, [server.guild_id]: e.target.value }))}
                  className="flex-1 min-w-[12rem] bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" data-testid={`discord-follow-source-${server.guild_id}`}>
                  {server.news_channels.map((row) => <option key={row.id} value={row.id}>{channelLabel(row)}</option>)}
                </select>
                {server.state !== "followed" && (
                  <button type="button" onClick={() => follow(server)} disabled={busy || !server.can_setup || !sources[server.guild_id]} data-testid={`discord-follow-setup-${server.guild_id}`}
                    className="px-3 py-2 bg-[#5865F2] text-white text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">
                    Einrichten
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {!servers.length && <p className="text-sm text-white/45" data-testid="discord-follow-none">Es gibt keinen eingeschalteten Unterserver – unter „Server“ einschalten.</p>}
      </div>
      {data.manual && <p className="text-xs text-white/45" data-testid="discord-follow-manual">{data.manual}</p>}
    </div>
  );
}

export function DistributeBox() {
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState({ title: "", text: "", target: "community", guild_ids: [] });
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get("/settings/discord/distribute")
      .then(({ data }) => {
        if (!alive) return;
        setOptions(data || null);
        setForm((current) => ({ ...current, guild_ids: (data?.servers || []).map((row) => row.guild_id) }));
      })
      .catch((err) => toast.error(formatApiError(err.response?.data?.detail)));
    return () => { alive = false; };
  }, []);

  // Jede Änderung verwirft die Vorschau - gesendet wird nur, was man zuletzt gesehen hat.
  const change = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setPlan(null);
    setResult(null);
  };
  const toggleServer = (guildId) => change({ guild_ids: form.guild_ids.includes(guildId) ? form.guild_ids.filter((id) => id !== guildId) : [...form.guild_ids, guildId] });
  const body = () => ({ text: form.text, title: form.title, target: form.target, guild_ids: form.guild_ids });

  const preview = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setPlan((await api.post("/settings/discord/distribute", { ...body(), preview: true })).data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/settings/discord/distribute", body());
      setResult(data);
      setPlan(null);
      if (data?.sent) toast.success(`Gesendet an ${data.sent} Server.`);
      else toast.error("Nirgends angekommen – die Gründe stehen darunter.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  if (!options) return null;
  const servers = Array.isArray(options.servers) ? options.servers : [];
  const limit = options.max_text || 1800;
  const ready = (plan?.servers || []).filter((row) => row.ready);
  const tooLong = form.text.length > limit;
  return (
    <div className={BOX} data-testid="discord-distribute">
      <div>
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><Share2 className="w-4 h-4 text-[#5865F2]" /> Mitteilung verteilen</div>
        <p className="mt-1 text-xs text-white/50">
          Ein Text an mehrere Server – je Server in den Kanal des gewählten Ziels. Niemand wird erwähnt. Erst die Vorschau, dann das Senden; jede Sendung steht im Versand-Log.
          Im Discord geht dasselbe mit <code className="text-white/70">/verteilen</code> (Turnierleitung und Vorstand).
        </p>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_14rem] gap-3">
        <label className="block text-sm">
          <span className="block text-xs text-white/55 mb-1">Überschrift</span>
          <input value={form.title} onChange={(e) => change({ title: e.target.value })} maxLength={120} placeholder={options.default_title || "Mitteilung"} className={FIELD} data-testid="discord-distribute-title" />
        </label>
        <label className="block text-sm">
          <span className="block text-xs text-white/55 mb-1">Ziel</span>
          <select value={form.target} onChange={(e) => change({ target: e.target.value })} className={FIELD} data-testid="discord-distribute-target">
            {(options.targets || []).map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="block text-xs text-white/55 mb-1">
          Text
          <span className={`float-right${tooLong ? " text-[#FF3B30]" : ""}`} data-testid="discord-distribute-count">{form.text.length} / {limit}</span>
        </span>
        <textarea value={form.text} onChange={(e) => change({ text: e.target.value })} rows={4} className={FIELD} data-testid="discord-distribute-text" />
      </label>
      <fieldset>
        <legend className="text-xs text-white/55 mb-1">Server</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {servers.map((row) => (
            <label key={row.guild_id} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.guild_ids.includes(row.guild_id)} onChange={() => toggleServer(row.guild_id)} className="accent-[#5865F2]" data-testid={`discord-distribute-server-${row.guild_id}`} />
              <span>{row.name}{row.main ? <span className="text-white/40"> (Hauptserver)</span> : null}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" onClick={preview} disabled={busy || !form.text.trim() || tooLong || !form.guild_ids.length} data-testid="discord-distribute-preview"
        className="px-4 py-2 border border-[#5865F2]/60 text-[#b8c0ff] text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">
        Vorschau
      </button>
      {plan && (
        <div className="space-y-3 border-t border-white/5 pt-4" data-testid="discord-distribute-plan">
          <DiscordMessagePreview embed={{ title: plan.title, description: plan.text, color: EMBED_COLOR, footer: { text: plan.footer } }} testId="discord-distribute-message" />
          <ul className="text-xs space-y-1">
            {(plan.servers || []).map((row) => (
              <li key={row.guild_id} className={row.ready ? "text-white/70" : "text-[#FFD700]"} data-testid={`discord-distribute-plan-${row.guild_id}`}>
                {row.name}: {row.ready ? (row.fallback ? "geht in Community – für dieses Ziel ist dort kein Kanal gewählt" : "Kanal gewählt") : "kein Kanal gewählt – dort kommt nichts an"}
              </li>
            ))}
          </ul>
          <button type="button" onClick={send} disabled={busy || !ready.length} data-testid="discord-distribute-send"
            className="px-4 py-2 bg-[#5865F2] text-white text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">
            An {ready.length} Server senden
          </button>
        </div>
      )}
      {result && (
        <ul className="text-xs space-y-1 border-t border-white/5 pt-4" data-testid="discord-distribute-result">
          {(result.servers || []).map((row) => (
            <li key={row.guild_id} className={row.ok ? "text-[#00FF88]" : "text-[#FF3B30]"} data-testid={`discord-distribute-result-${row.guild_id}`}>
              {row.name}: {row.ok ? "gesendet" : (row.error || "nicht angekommen")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DiscordForwardPanel() {
  return (
    <>
      <FollowBox />
      <DistributeBox />
    </>
  );
}
