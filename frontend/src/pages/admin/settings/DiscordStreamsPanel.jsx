import { useCallback, useEffect, useState } from "react";
import { Palette, Radio } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { channelOptionLabel } from "./DiscordTargets";
import { whenText } from "./DiscordEmbedsPanel";

// Stream-Meldungen je Stream (#866): sobald jemand aus dem Verein live geht, eine Meldung im gewählten Kanal - wie
// bei Stream-Bots; alle zehn Minuten aktualisiert, am Ende „war live“ oder gelöscht. Wer gemeldet wird, entscheidet
// dieselbe Regel wie auf der Startseite. Das Aussehen steht im Reiter „Gestaltung“.

const INPUT = "w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm";

export function streamStateText(state) {
  if (!state) return "";
  if (state.reason_text) return state.reason_text;
  const parts = [state.open ? `${state.open} ${state.open === 1 ? "Stream wird" : "Streams werden"} gerade gemeldet` : "gerade niemand live"];
  if (state.last_run_at) parts.push(`zuletzt geprüft ${whenText(state.last_run_at)}`);
  if (state.last_error) parts.push(`letzter Fehler: ${state.last_error}`);
  return parts.join(" · ");
}

export function DiscordStreamsPanel({ onDesign }) {
  const [state, setState] = useState(null);
  const [draft, setDraft] = useState({});
  const [channels, setChannels] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/discord/streams");
      setState(data);
      setDraft({ enabled: !!data.enabled, channel_id: data.channel_id || "", on_end: data.on_end || "edit", role_id: data.role_id || "" });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, []);
  useEffect(() => {
    load();
    api.get("/settings/discord/channels").then(({ data }) => setChannels(data?.channels || [])).catch(() => setChannels([]));
  }, [load]);

  if (!state) return null;
  const chosenRole = (state.roles || []).find((role) => role.id === draft.role_id);
  const dirty = draft.enabled !== !!state.enabled || draft.channel_id !== (state.channel_id || "") || draft.on_end !== (state.on_end || "edit") || draft.role_id !== (state.role_id || "");
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.put("/settings/discord/streams", draft);
      setState((current) => ({ ...current, ...data }));
      toast.success(draft.enabled ? "Stream-Meldungen gespeichert – der nächste Stream wird gemeldet." : "Stream-Meldungen aus.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-white/10 rounded-sm p-4 space-y-3" data-testid="discord-streams">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-black uppercase inline-flex items-center gap-2"><Radio className="w-4 h-4 text-[#9146FF]" /> Stream-Meldungen</h3>
          <p className="mt-1 text-xs text-white/55 max-w-2xl">
            Je Stream eine Meldung, sobald jemand aus dem Verein live geht – mit Titel, Spiel, Zuschauern und Vorschaubild. Alle zehn Minuten
            aktualisiert, am Ende „war live“ oder gelöscht. Gemeldet wird, wer auch auf der Startseite erscheint.
          </p>
        </div>
        {onDesign && (
          <button type="button" onClick={onDesign} data-testid="discord-streams-design"
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#5865F2]/50 text-[#b8c0ff] rounded-sm text-[11px] font-bold uppercase tracking-wider">
            <Palette className="w-3.5 h-3.5" /> Aussehen gestalten
          </button>
        )}
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} data-testid="discord-streams-enabled" className="accent-[#9146FF]" />
        Stream-Meldungen an
      </label>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block text-xs">
          <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Kanal</div>
          <select value={draft.channel_id} onChange={(event) => setDraft((current) => ({ ...current, channel_id: event.target.value }))} className={INPUT} data-testid="discord-streams-channel">
            <option value="">– kein Kanal –</option>
            {draft.channel_id && !channels.some((channel) => String(channel.id) === draft.channel_id) && <option value={draft.channel_id}>Kanal {draft.channel_id}</option>}
            {channels.map((channel) => <option key={channel.id} value={String(channel.id)} disabled={!channel.can_send}>{channelOptionLabel(channel, "community")}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Wenn der Stream endet</div>
          <select value={draft.on_end} onChange={(event) => setDraft((current) => ({ ...current, on_end: event.target.value }))} className={INPUT} data-testid="discord-streams-end">
            <option value="edit">Meldung zu „war live“ machen</option>
            <option value="delete">Meldung löschen</option>
          </select>
        </label>
        <label className="block text-xs">
          <div className="uppercase tracking-widest text-white/45 font-bold mb-1">Rolle erwähnen</div>
          {state.roles_available ? (
            <select value={draft.role_id} onChange={(event) => setDraft((current) => ({ ...current, role_id: event.target.value }))} className={INPUT} data-testid="discord-streams-role">
              <option value="">– niemanden –</option>
              {state.roles.map((role) => <option key={role.id} value={role.id}>@{role.name}</option>)}
            </select>
          ) : (
            <input value={draft.role_id} onChange={(event) => setDraft((current) => ({ ...current, role_id: event.target.value.replace(/\D/g, "") }))} placeholder="Rollen-ID (optional)" className={INPUT} data-testid="discord-streams-role" />
          )}
          <div className="mt-1 text-white/40">Pingt einmal beim Start – nie @everyone.</div>
          {chosenRole && chosenRole.mentionable === false && (
            <div className="mt-1 text-[#FFD700]" data-testid="discord-streams-role-hint">
              Discord pingt diese Rolle nicht: Servereinstellungen → Rollen → @{chosenRole.name} → „Jedem erlauben, diese Rolle zu @erwähnen“ einschalten.
            </div>
          )}
        </label>
      </div>
      <div className={`text-xs ${state.last_error || state.reason ? "text-[#FFD700]" : "text-white/50"}`} data-testid="discord-streams-state">{streamStateText(state)}</div>
      <button type="button" disabled={busy || !dirty} onClick={save} data-testid="discord-streams-save"
        className="px-4 py-2 bg-[#9146FF] text-white font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">Speichern</button>
    </section>
  );
}
