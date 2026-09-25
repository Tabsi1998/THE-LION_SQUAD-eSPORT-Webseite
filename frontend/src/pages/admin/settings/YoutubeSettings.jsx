import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Youtube } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

// YouTube → News (#578): neue Videos des Vereinskanals werden von selbst News der Art „Video“ - als
// Entwurf oder gleich veröffentlicht, Shorts wahlweise. Hier stehen die Schalter, der Kanal, der letzte
// Abruf, das letzte Video und Fehler im Klartext; „Jetzt abrufen“ wartet nicht auf den Job.

export function whenText(value) {
  if (!value) return "noch nie";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("de-DE");
}

export function fetchResultText(result) {
  if (!result) return "Abruf fertig.";
  if (result.error) return `Abruf fehlgeschlagen: ${result.error}`;
  if (result.baseline) return `Erster Abruf: ${result.seen} vorhandene Videos gemerkt – ab jetzt wird jedes neue Video eine News.`;
  const parts = [`${result.created} neue News`];
  if (result.skipped_shorts) parts.push(`${result.skipped_shorts} Shorts übersprungen`);
  return `Abruf fertig: ${parts.join(", ")}.`;
}

export function YoutubeSettings() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState("");
  const [channelUrl, setChannelUrl] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/settings/youtube");
      setData(result);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["settings"], { fallbackMs: 0 });

  const save = async (patch, message) => {
    if (busy) return;
    setBusy("save");
    try {
      const { data: result } = await api.put("/settings/youtube", patch);
      setData(result);
      setChannelUrl(null);
      if (message) toast.success(message);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };
  const fetchNow = async () => {
    if (busy) return;
    setBusy("fetch");
    try {
      const { data: result } = await api.post("/settings/youtube/fetch");
      setData(result);
      if (result?.result?.error) toast.error(fetchResultText(result.result));
      else toast.success(fetchResultText(result.result));
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };

  if (!data) {
    return loadError ? <div className="text-xs text-[#FF6B6B]" data-testid="youtube-feed-error">Der Stand von YouTube → News konnte nicht geladen werden.</div> : null;
  }
  const url = channelUrl ?? (data.channel_url || "");
  const effective = data.channel_url || data.branding_url;
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="youtube-feed">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><Youtube className="w-4 h-4 text-[#FF3B30]" /> Videos als News</div>
          <p className="mt-1 text-xs text-white/50 max-w-2xl">
            Neue Videos des Vereinskanals werden von selbst News der Art „Video“ – mit Vorschaubild, Player und Link. Quelle ist der öffentliche Feed des Kanals (kein Schlüssel, kein Kontingent), geprüft alle {data.interval_minutes || 15} Minuten.
            Beim ersten Abruf werden vorhandene Videos nur gemerkt; ab dann wird jedes neue Video genau einmal eine News. Eine veröffentlichte Video-News geht wie jede News in den Discord.
          </p>
        </div>
        <button type="button" onClick={fetchNow} disabled={!!busy} data-testid="youtube-feed-fetch" className="px-3 py-2 border border-[#FF3B30]/60 text-white text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
          <RefreshCw className={`w-3 h-3 ${busy === "fetch" ? "animate-spin" : ""}`} /> Jetzt abrufen
        </button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!data.enabled} disabled={!!busy} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "Abruf an." : "Abruf aus – es entstehen keine News mehr.")} className="accent-[#FF3B30]" data-testid="youtube-feed-enabled" />
          <span>Automatisch abrufen</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!data.publish} disabled={!!busy} onChange={(e) => save({ publish: e.target.checked }, e.target.checked ? "Neue Videos werden gleich veröffentlicht." : "Neue Videos werden als Entwurf angelegt.")} className="accent-[#FF3B30]" data-testid="youtube-feed-publish" />
          <span>Gleich veröffentlichen <span className="text-white/40">(sonst Entwurf)</span></span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!data.include_shorts} disabled={!!busy} onChange={(e) => save({ include_shorts: e.target.checked })} className="accent-[#FF3B30]" data-testid="youtube-feed-shorts" />
          <span>Auch Shorts</span>
        </label>
      </div>
      <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
        <div>
          <input value={url} onChange={(e) => setChannelUrl(e.target.value)} placeholder={data.branding_url ? `Standard: ${data.branding_url}` : "https://www.youtube.com/@Vereinskanal"} data-testid="youtube-feed-channel" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <p className="mt-1 text-[11px] text-white/40">Leer = die YouTube-Adresse aus Einstellungen → Branding. Ein Handle (@…) wird beim ersten Abruf einmal zur Kanal-ID aufgelöst.</p>
        </div>
        <button type="button" onClick={() => save({ channel_url: url.trim() }, "Kanal gespeichert.")} disabled={!!busy || channelUrl === null} data-testid="youtube-feed-channel-save" className="px-3 py-2 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Speichern</button>
      </div>
      <div className="border border-white/5 rounded-sm divide-y divide-white/5 text-xs" data-testid="youtube-feed-status">
        <div className="flex flex-wrap justify-between gap-2 px-3 py-2"><span className="text-white/45">Kanal</span><span data-testid="youtube-feed-channel-id">{data.channel_id ? `${data.channel_id} (${effective || "–"})` : effective ? `${effective} – Kanal-ID kommt beim ersten Abruf` : "keine YouTube-Adresse hinterlegt"}</span></div>
        <div className="flex flex-wrap justify-between gap-2 px-3 py-2"><span className="text-white/45">Letzter Abruf</span><span data-testid="youtube-feed-last-run">{whenText(data.last_run_at)}</span></div>
        <div className="flex flex-wrap justify-between gap-2 px-3 py-2"><span className="text-white/45">Letztes Video</span>
          <span data-testid="youtube-feed-last-video">{data.last_video?.title ? <a href={data.last_video.url} target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline">{data.last_video.title}</a> : "–"}</span>
        </div>
        <div className="flex flex-wrap justify-between gap-2 px-3 py-2"><span className="text-white/45">Gemerkt / als News angelegt</span><span data-testid="youtube-feed-counts">{data.videos_seen || 0} / {data.news_created || 0}</span></div>
        {data.last_error && <div className="px-3 py-2 text-[#FF6B6B] break-words" data-testid="youtube-feed-last-error">{data.last_error}</div>}
      </div>
    </div>
  );
}
