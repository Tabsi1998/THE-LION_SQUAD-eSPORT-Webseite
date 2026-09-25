import { useCallback, useEffect, useState } from "react";
import { Eye, Send, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { DiscordMessagePreview } from "@/components/tls/DiscordMessagePreview";

// Vorschau jeder Meldungsart (#583): der Server baut jede Meldung mit denselben Funktionen wie im
// Betrieb - aus den letzten echten Daten, wenn es welche gibt, sonst aus festen Beispielen - und die
// Seite zeigt sie als Discord-Nachbildung. „In den Testkanal senden“ schickt genau dieses Embed mit dem
// Vermerk „Test“ in den privaten Testkanal (fehlt er, geht nichts raus - nie in einen öffentlichen
// Kanal); „An mich“ schickt es als Direktnachricht an das verknüpfte Discord-Konto des Admins.

export function sendResultText(via, result) {
  if (result?.ok) return via === "dm" ? "Direktnachricht an dich gesendet." : `Test gesendet${result.channel_name ? ` in #${result.channel_name}` : " in den Testkanal"}.`;
  return `Nicht gesendet: ${result?.error || result?.reason || "unbekannt"}`;
}

export function DiscordSamplesPanel() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/settings/discord/samples");
      setData(result);
      setLoadError("");
    } catch (err) {
      setLoadError(formatApiError(err.response?.data?.detail) || "Die Vorschau konnte nicht geladen werden.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async (key, via) => {
    if (busy) return;
    setBusy(`${key}:${via}`);
    try {
      const { data: result } = await api.post(`/settings/discord/samples/${encodeURIComponent(key)}/send?via=${via}`);
      if (result?.ok) toast.success(sendResultText(via, result));
      else toast.error(sendResultText(via, result));
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };

  const testChannel = data?.test_channel || {};
  const dm = data?.dm || {};
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const entries = Array.isArray(data?.entries) ? data.entries : [];

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-5" data-testid="discord-samples" id="vorschau">
      <div>
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><Eye className="w-4 h-4 text-[#5865F2]" /> Vorschau: so sehen die Meldungen aus</div>
        <p className="mt-1 text-xs text-white/50">
          Jede Meldungsart, die die Website kennt – gebaut wie im Betrieb, mit Beispieldaten oder den letzten echten Daten. Die Nachbildung ist eine Annäherung;
          „In den Testkanal senden“ schickt genau dieses Embed echt in den Testkanal (mit Vermerk „Test“, nie an die Community), „An mich“ als Direktnachricht an dein verknüpftes Discord-Konto.
        </p>
      </div>
      <div className={`border rounded-sm p-3 text-xs ${testChannel.configured ? "border-[#00FF88]/25 bg-[#00FF88]/5 text-white/70" : "border-[#FFD700]/40 bg-[#FFD700]/10 text-white/80"}`} data-testid="discord-samples-test-channel">
        {testChannel.configured
          ? <>Testkanal: <strong>{testChannel.channel_name ? `#${testChannel.channel_name}` : "gewählt"}</strong> – privat, Tests zählen nicht als Meldung.</>
          : <>Kein Testkanal gewählt – oben unter „Kanäle je Zweck“ beim Ziel <strong>Test</strong> einen privaten Kanal wählen (etwa #bot-test). Bis dahin geht aus der Vorschau nichts in einen Kanal.</>}
        {!dm.linked && <div className="mt-1 text-white/60" data-testid="discord-samples-dm-hint">„An mich“ braucht dein verknüpftes Discord-Konto (Profil → Socials → Discord).</div>}
      </div>
      {loadError && <div className="text-xs text-[#FF6B6B]" data-testid="discord-samples-error">{loadError}</div>}
      {groups.map((group) => {
        const rows = entries.filter((entry) => entry.group === group.key);
        if (!rows.length) return null;
        return (
          <div key={group.key} className="space-y-3" data-testid={`discord-samples-group-${group.key}`}>
            <div className="font-heading font-bold uppercase text-sm">{group.label}</div>
            {rows.map((entry) => (
              <div key={entry.key} className="border border-white/10 rounded-sm p-3 space-y-2" data-testid={`discord-sample-${entry.key}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-bold">{entry.label}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
                    {entry.enabled === false && <span className="text-[#FFD700]" data-testid={`discord-sample-${entry.key}-off`}>Ereignis aus</span>}
                    <span>{entry.source_text}</span>
                  </div>
                </div>
                <DiscordMessagePreview embed={entry.embed} botName={data?.bot_name || "Vereins-Bot"} testId={`discord-sample-${entry.key}-message`} />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => send(entry.key, "test")} disabled={!!busy} data-testid={`discord-sample-${entry.key}-test`}
                    className="px-3 py-1.5 border border-[#5865F2]/60 text-[#b8c0ff] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
                    <Send className="w-3 h-3" /> In den Testkanal senden
                  </button>
                  <button type="button" onClick={() => send(entry.key, "dm")} disabled={!!busy} data-testid={`discord-sample-${entry.key}-dm`}
                    className="px-3 py-1.5 border border-white/20 text-white/70 text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
                    <UserRound className="w-3 h-3" /> An mich als Direktnachricht
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
      {data && !entries.length && !loadError && <div className="text-xs text-white/40">Keine Meldungsarten bekannt.</div>}
    </div>
  );
}
