import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { CalendarDays, Copy, Eye, Flag, Image as ImageIcon, Monitor, Printer, QrCode, Radio, Trophy } from "lucide-react";

function safeWidgetUrl({ type, id, track, base }) {
  if (!id || !/^[A-Za-z0-9_-]+$/.test(String(id))) return "";
  const path = type === "bracket" ? `/display/bracket/${encodeURIComponent(id)}`
    : type === "f1" ? `/display/f1/${encodeURIComponent(id)}`
      : type === "event" ? `/display/event/${encodeURIComponent(id)}` : "";
  if (!path) return "";
  try {
    const next = new URL(path, base);
    if (type === "f1" && track) next.searchParams.set("track", String(track));
    return next.toString();
  } catch {
    return "";
  }
}

function escapeHtmlAttribute(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

export default function AdminWidgetsPage() {
  const [tournaments, setTournaments] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [events, setEvents] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [mode, setMode] = useState("embed");
  const [selType, setSelType] = useState("bracket");
  const [selId, setSelId] = useState("");
  const [qrEventId, setQrEventId] = useState("");
  const [qrEvent, setQrEvent] = useState(null);
  const [qrStations, setQrStations] = useState([]);
  const [qrMatches, setQrMatches] = useState([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [tracks, setTracks] = useState([]);
  const [selTrack, setSelTrack] = useState("");
  const [height, setHeight] = useState(600);

  const loadSources = useCallback(() => {
    api.get("/tournaments?include_drafts=true").then(({ data }) => setTournaments(data));
    api.get("/f1/challenges?include_drafts=true").then(({ data }) => setChallenges(data));
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data));
    api.get("/admin/gallery").then(({ data }) => setAlbums(data || [])).catch(() => setAlbums([]));
  }, []);
  useEffect(() => { loadSources(); }, [loadSources]);
  useApiInvalidation(loadSources, ["tournaments", "f1", "events", "gallery"]);

  useEffect(() => {
    setTracks([]);
    setSelTrack("");
    if (selType !== "f1" || !selId) return;
    api.get(`/f1/challenges/${selId}?include_draft=true`).then(({ data }) => setTracks(data.tracks || [])).catch(() => setTracks([]));
  }, [selType, selId]);

  useEffect(() => {
    setQrEvent(null);
    setQrStations([]);
    setQrMatches([]);
    if (!qrEventId) return;
    let active = true;
    setQrLoading(true);
    api.get(`/events/${qrEventId}`)
      .then(async ({ data }) => {
        const eventTournaments = data.tournaments || [];
        const stationResponses = await Promise.allSettled([
          api.get(`/stations?event_id=${encodeURIComponent(data.id)}`),
          ...eventTournaments.map((tournament) => api.get(`/stations?tournament_id=${encodeURIComponent(tournament.id)}`)),
        ]);
        const bracketResponses = await Promise.allSettled(
          eventTournaments.map((tournament) => api.get(`/tournaments/${tournament.id}/bracket`))
        );
        if (!active) return;
        const stationRows = stationResponses
          .filter((result) => result.status === "fulfilled")
          .flatMap((result) => result.value.data || []);
        const matchRows = bracketResponses
          .filter((result) => result.status === "fulfilled")
          .flatMap((result) => qrMatchesFromBracket(result.value.data));
        setQrEvent(data);
        setQrStations(Array.from(new Map(stationRows.map((station) => [station.id, station])).values()));
        setQrMatches(matchRows);
      })
      .catch(() => {
        if (active) toast.error("Event-QR-Daten konnten nicht geladen werden.");
      })
      .finally(() => {
        if (active) setQrLoading(false);
      });
    return () => { active = false; };
  }, [qrEventId]);

  const publicBase = typeof window !== "undefined" ? window.location.origin : API_BASE;
  const url = safeWidgetUrl({ type: selType, id: selId, track: selTrack, base: publicBase });
  const iframe = url ? `<iframe src="${escapeHtmlAttribute(url)}" width="100%" height="${Number(height) || 600}" frameborder="0" style="border:none"></iframe>` : "";

  const copy = () => {
    navigator.clipboard.writeText(iframe);
    toast.success("Einbettungscode kopiert.");
  };

  const options = selType === "bracket" ? tournaments : selType === "event" ? events : challenges;
  const qrLinks = useMemo(() => buildQrLinks({ event: qrEvent, stations: qrStations, matches: qrMatches, albums, base: publicBase }), [albums, publicBase, qrEvent, qrMatches, qrStations]);
  const copyQrLinks = async () => {
    await navigator.clipboard.writeText(qrLinks.map((item) => `${item.label}: ${item.url}`).join("\n"));
    toast.success("QR-Linkliste kopiert.");
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Einbettungen</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Widgets & Einbettungen</h1>
      <div className="mb-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode("embed")} className={`px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold ${mode === "embed" ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}>Displays</button>
        <button type="button" onClick={() => setMode("qr")} className={`inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold ${mode === "qr" ? "bg-[#FFD700] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}><QrCode className="w-3.5 h-3.5" /> Vor-Ort QR</button>
      </div>

      {mode === "embed" ? (
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
          <Select label="Typ" value={selType} onChange={(v)=>{ setSelType(v); setSelId(""); setSelTrack(""); }} options={[["bracket","Turnierbaum"],["f1","Fast-Lap-Rangliste"],["event","Event-Live"]]} testId="widget-type"/>
          <Select label="Quelle" value={selId} onChange={(v)=>{ setSelId(v); setSelTrack(""); }} options={[["","— auswählen —"],...options.map(o=>[o.id, o.title || o.name])]} testId="widget-source"/>
          {selType === "f1" && tracks.length > 0 && (
            <Select label="Strecke" value={selTrack} onChange={setSelTrack} options={[["","Automatisch rotieren"],...tracks.map(t=>[t.id, t.name])]} testId="widget-track"/>
          )}
          <Field label="Höhe (px)" type="number" value={height} onChange={(v)=>setHeight(Number(v)||600)} testId="widget-height"/>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Einbettungscode</div>
            <textarea readOnly value={iframe} rows={5} data-testid="widget-iframe" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-xs font-mono"/>
          </div>
          <div className="flex gap-2">
            <button onClick={copy} disabled={!iframe} data-testid="widget-copy" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 disabled:opacity-40"><Copy className="w-3.5 h-3.5"/> Kopieren</button>
            {url && <a href={url} target="_blank" rel="noreferrer" className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Eye className="w-3.5 h-3.5"/> Vorschau</a>}
          </div>
        </div>
        <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden min-h-[400px]">
          {url ? <iframe src={url} className="w-full h-full min-h-[600px]" frameBorder="0" title="preview"/> : <div className="p-10 text-center text-white/40 font-display tracking-widest">VORSCHAU</div>}
        </div>
      </div>
      ) : (
      <div className="space-y-5">
        <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
            <Select label="Event" value={qrEventId} onChange={setQrEventId} options={[["","Event auswaehlen"], ...events.map((event) => [event.id, event.name])]} testId="qr-event"/>
            <button type="button" onClick={copyQrLinks} disabled={!qrLinks.length} className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-white/15 text-white/70 rounded-sm text-xs uppercase tracking-wider font-bold hover:text-white disabled:opacity-40">
              <Copy className="w-3.5 h-3.5" /> Links kopieren
            </button>
            <button type="button" onClick={() => window.print()} disabled={!qrLinks.length} className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#FFD700] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-40">
              <Printer className="w-3.5 h-3.5" /> Drucken
            </button>
          </div>
          <p className="mt-3 text-xs text-white/45">Erzeugt QR-Codes fuer Eventdetails, Live-Seite, Display, Turniere/Check-in, Matchseiten, Stationen, Galerie und Feedback.</p>
        </div>
        {qrLoading ? (
          <div className="border border-white/10 bg-[#121212] rounded-sm p-10 text-center text-white/40">Lade QR-Daten...</div>
        ) : qrLinks.length ? (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 print:grid-cols-2">
            {qrLinks.map((item) => <QrCard key={`${item.kind}-${item.id}`} item={item} />)}
          </div>
        ) : (
          <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/45">Event auswaehlen, dann erscheinen die Vor-Ort-QR-Codes automatisch.</div>
        )}
      </div>
      )}
    </AdminLayout>
  );
}

function qrMatchesFromBracket(payload) {
  const registrations = new Map((payload?.registrations || []).map((registration) => [registration.id, registration]));
  const tournament = payload?.tournament || {};
  const legacy = (payload?.matches || []).map((match) => ({
    id: match.id,
    tournamentTitle: tournament.title,
    stationId: match.station_id,
    stationLabel: match.station_label || match.station_name || match.station?.name || match.station_id,
    label: [registrations.get(match.participant_a_id), registrations.get(match.participant_b_id)]
      .map((registration) => registration?.display_name || registration?.ingame_name)
      .filter(Boolean)
      .join(" vs. ") || match.round_name || `Match ${match.match_key || match.id}`,
  }));
  const multi = (payload?.matches_v2 || []).map((match) => ({
    id: match.id,
    tournamentTitle: tournament.title,
    stationId: match.station_id,
    stationLabel: match.station_label || match.station_name || match.station?.name || match.station_id,
    label: (match.slots || [])
      .map((slot) => registrations.get(slot.registration_id)?.display_name || registrations.get(slot.registration_id)?.ingame_name || slot.source?.raw)
      .filter(Boolean)
      .join(" vs. ") || match.round_name || `Match ${match.match_key || match.id}`,
  }));
  return [...legacy, ...multi].filter((match) => match.id).slice(0, 80);
}

function buildQrLinks({ event, stations, matches, albums, base }) {
  if (!event) return [];
  const eventPath = `/events/${event.slug || event.id}`;
  const eventAlbums = (albums || []).filter((album) => album.event_id === event.id && album.slug);
  const rows = [
    { kind: "event", id: "details", label: "Eventdetails", description: event.name, icon: CalendarDays, path: eventPath },
    { kind: "event", id: "live", label: "Event Live", description: "Zeitplan, Matches und Ergebnisse", icon: Radio, path: `${eventPath}/live` },
    { kind: "event", id: "display", label: "Event Display", description: "TV-Ansicht fuer Beamer und Screens", icon: Monitor, path: `/display/event/${event.id}` },
    { kind: "feedback", id: "feedback", label: "Feedback", description: "Kontaktformular fuer Rueckmeldungen", icon: QrCode, path: `/contact?subject=${encodeURIComponent(`Feedback ${event.name || ""}`)}` },
    ...(event.tournaments || []).flatMap((tournament) => {
      const path = `/tournaments/${tournament.slug || tournament.id}`;
      return [
        { kind: "tournament", id: `${tournament.id}-checkin`, label: "Turnier / Check-in", description: tournament.title, icon: Trophy, path },
        { kind: "schedule", id: `${tournament.id}-matches`, label: "Spielplan", description: tournament.title, icon: CalendarDays, path: `${path}/matches` },
      ];
    }),
    ...(event.f1_challenges || []).map((challenge) => ({
      kind: "fastlap",
      id: challenge.id,
      label: "Fast Lap",
      description: challenge.title,
      icon: Flag,
      path: `/fastlap/${challenge.slug || challenge.id}`,
    })),
    ...matches.slice(0, 18).map((match) => ({
      kind: "match",
      id: match.id,
      label: match.stationLabel ? `Match an ${match.stationLabel}` : "Match",
      description: `${match.tournamentTitle || "Turnier"} - ${match.label}`,
      icon: Trophy,
      path: `/matches/${match.id}`,
    })),
    ...stations.slice(0, 18).map((station) => ({
      kind: "station",
      id: station.id,
      label: station.name || station.label || "Station",
      description: station.notes || station.device_type || "Station-Infos im Event Live",
      icon: Monitor,
      path: `${eventPath}/live?station=${encodeURIComponent(station.id)}`,
    })),
    ...eventAlbums.slice(0, 8).map((album) => ({
      kind: "gallery",
      id: album.id,
      label: "Galerie",
      description: album.title,
      icon: ImageIcon,
      path: `/galerie/${album.slug}`,
    })),
  ];
  return rows.map((row) => ({ ...row, url: new URL(row.path, base).toString() }));
}

function QrCard({ item }) {
  const Icon = item.icon || QrCode;
  const copyUrl = async () => {
    await navigator.clipboard.writeText(item.url);
    toast.success("QR-Link kopiert.");
  };
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4 min-w-0 print:bg-white print:text-black print:border-black">
      <div className="flex items-start gap-4">
        <div className="shrink-0 rounded-sm bg-white p-2">
          <QRCodeSVG value={item.url} size={116} bgColor="#ffffff" fgColor="#0A0A0A" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8] print:text-black">
            <Icon className="w-3.5 h-3.5" /> {item.label}
          </div>
          <div className="mt-2 font-heading text-lg font-black uppercase leading-tight break-words">{item.description}</div>
          <div className="mt-2 text-[11px] text-white/45 break-all print:text-black/70">{item.url}</div>
          <button type="button" onClick={copyUrl} className="mt-3 inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/70 rounded-sm text-[10px] uppercase tracking-wider font-bold hover:text-white print:hidden">
            <Copy className="w-3 h-3" /> Kopieren
          </button>
        </div>
      </div>
    </div>
  );
}
function Field({ label, value, onChange, type="text", testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><input type={type} value={value||""} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/></label>);
}
function Select({ label, value, onChange, options, testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><select value={value} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>);
}
