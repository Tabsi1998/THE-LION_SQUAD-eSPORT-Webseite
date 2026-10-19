import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { api, formatRequestError } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { gameLabel } from "@/lib/gameLabels";
import { viennaDateTime } from "@/lib/vienna";
import {
  PAPER, PRINT_DEFAULTS, PRINT_PARTS, bracketPages, checkinPages, dayPlanPages, eventCheckinSections, parseParts, schedulePages, stampText,
  tournamentCheckinSections,
} from "@/lib/printView";
import { CheckinBody, DayPlanBody, PrintSheet, ScheduleBody, TreeBody } from "@/components/tls/print/PrintSheets";

// Druckansicht (#1283): Plan B auf Papier. Am Vorabend Baum, Spielplan, Check-in-Liste und Tagesplan drucken - fällt am
// Event Netz oder Server aus, läuft das Turnier auf dem Ausdruck weiter. Eigene Adresse ohne Menü und Deko:
// /print/tournaments/<slug> und /print/events/<slug>, Auswahl in der Adresse (?teile=baum,liste&baum=quer&listen=hoch
// &plan=zeit), damit ein Link genau diesen Druck wieder öffnet. Gedruckt wird erst auf Knopfdruck (am Handy über das
// Teilen- bzw. Druckmenü als PDF). Die Check-in-Liste gibt es nur mit Turnier-Recht - der Server prüft es selbst.

const START = { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" };
const ORIENTATION = { quer: "landscape", hoch: "portrait" };
const ORIENTATION_PARAM = { landscape: "quer", portrait: "hoch" };
const MM_TO_PX = 96 / 25.4;

const KICKER = { baum: "Turnierbaum", spielplan: "Spielplan", liste: "Check-in-Liste", tagesplan: "Tagesplan" };
const EMPTY_TEXT = {
  baum: "Der Turnierbaum steht noch nicht – er erscheint nach der Auslosung.",
  spielplan: "Es gibt noch keine Spiele.",
  tagesplan: "Für dieses Event steht noch nichts mit Uhrzeit fest.",
  liste: "Noch niemand angemeldet.",
};

function useAvailableWidth() {
  const read = () => (typeof window === "undefined" ? 1200 : Math.max(240, window.innerWidth - 32));
  const [width, setWidth] = useState(read);
  useEffect(() => {
    const onResize = () => setWidth(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function Choice({ legend, name, value, options, onChange }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <legend className="sr-only">{legend}</legend>
      <span className="text-[11px] font-bold uppercase tracking-wider text-white/55" aria-hidden="true">{legend}</span>
      {options.map(([key, label]) => (
        <label key={key} className="inline-flex min-h-11 items-center gap-2 text-sm text-white/85 cursor-pointer">
          <input type="radio" name={name} value={key} checked={value === key} onChange={() => onChange(key)} className="h-4 w-4 accent-[var(--tls-cyan)]" />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

export default function PrintPage({ scope = "tournament" }) {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const accessToken = params.get("access") || "";
  const [data, setData] = useState(null);
  const [list, setList] = useState(null);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());
  const available = useAvailableWidth();

  const staff = Boolean(data?.subject?.can_check_in);
  const parts = parseParts(params.get("teile"), scope, { staff: data ? staff : true });
  const treeOrientation = ORIENTATION[params.get("baum")] || PRINT_DEFAULTS.treeOrientation;
  const listOrientation = ORIENTATION[params.get("listen")] || PRINT_DEFAULTS.listOrientation;
  const scheduleOrder = params.get("plan") === "station" ? "station" : PRINT_DEFAULTS.scheduleOrder;
  const wantsList = parts.includes("liste");

  const subject = data?.subject;
  const name = subject?.title || subject?.name || "";
  useDocumentTitle(name ? `Druckansicht – ${name}` : "Druckansicht", "Druckansicht für Turnierbaum, Spielplan, Check-in-Liste und Tagesplan.", { robots: "noindex, nofollow" });

  useEffect(() => {
    let cancelled = false;
    const config = { params: accessToken ? { access: accessToken } : undefined };
    const load = scope === "event"
      ? api.get(`/events/${encodeURIComponent(slug)}`, config).then(({ data: event }) => ({ subject: event, bracket: null }))
      : api.get(`/tournaments/${encodeURIComponent(slug)}`, config).then(async ({ data: tournament }) => {
        const { data: bracket } = await api.get(`/tournaments/${tournament.id}/bracket`, config);
        return { subject: tournament, bracket };
      });
    load
      .then((next) => { if (!cancelled) setData(next); })
      .catch((reason) => { if (!cancelled) setError(formatRequestError(reason, "Die Druckansicht konnte nicht geladen werden.")); });
    return () => { cancelled = true; };
  }, [scope, slug, accessToken]);

  // Die Liste nur mit Recht und nur auf Wunsch - der Server lehnt alle anderen ab.
  useEffect(() => {
    if (!subject || !wantsList || !subject.can_check_in || list) return undefined;
    let cancelled = false;
    const request = scope === "event"
      ? api.get(`/events/${encodeURIComponent(subject.slug || subject.id)}/lead`, { params: { filter: "all" } }).then(({ data: lead }) => eventCheckinSections(lead))
      : api.get(`/tournaments/${subject.id}/print/checkin`).then(({ data: rows }) => tournamentCheckinSections(rows));
    request
      .then((sections) => { if (!cancelled) setList(sections); })
      .catch((reason) => { if (!cancelled) setListError(formatRequestError(reason, "Die Check-in-Liste konnte nicht geladen werden.")); });
    return () => { cancelled = true; };
  }, [scope, subject, wantsList, list]);

  const update = useCallback((changes) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  const togglePart = (key) => {
    const set = new Set(parts);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const ordered = PRINT_PARTS.map((part) => part.key).filter((item) => set.has(item));
    update({ teile: ordered.join(",") || "none" });
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const base = scope === "event" ? `/events/${subject?.slug || slug}` : `/tournaments/${subject?.slug || slug}`;
  const backTo = scope === "event" ? base : `${base}${params.get("von") === "spielplan" ? "/matches" : params.get("von") === "teilnehmer" ? "" : "/bracket"}`;
  const meta = subject
    ? [subject.start_date ? viennaDateTime(subject.start_date, START) : null, subject.game ? gameLabel(subject.game) : null, subject.location || subject.venue_name || null].filter(Boolean).join(" · ")
    : "";

  const sheets = useMemo(() => {
    if (!data) return [];
    const out = [];
    const push = (kind, pages, orientation, qrPath, qrLabel) => {
      if (!pages.length) {
        out.push({ kind, orientation, empty: true, qrPath, qrLabel });
        return;
      }
      pages.forEach((page) => out.push({ kind, orientation: page.orientation, page, qrPath, qrLabel }));
    };
    const avail = new Set(parts);
    if (scope === "tournament") {
      if (avail.has("baum")) push("baum", bracketPages(data.bracket, { orientation: treeOrientation }), treeOrientation, `${base}/bracket`, "Live-Turnierbaum");
      if (avail.has("spielplan")) push("spielplan", schedulePages(data.bracket, { orientation: listOrientation, order: scheduleOrder }), listOrientation, `${base}/matches`, "Live-Spielplan");
    } else if (avail.has("tagesplan")) {
      push("tagesplan", dayPlanPages(data.subject, { orientation: listOrientation }), listOrientation, `${base}/live`, "Live beim Event");
    }
    if (avail.has("liste") && staff && list) push("liste", checkinPages(list, { orientation: listOrientation }), listOrientation, `${base}/leitung`, "Einlass in der Turnierleitung");
    return out;
  }, [data, parts, scope, treeOrientation, listOrientation, scheduleOrder, base, staff, list]);

  const stamp = stampText(now);
  const printable = sheets.length > 0;
  const partOptions = PRINT_PARTS.filter((part) => (part.scope === scope || part.scope === "both") && (!part.staff || staff));

  return (
    <div className="tls-print-page min-h-screen bg-[#0A0A0A] text-white">
      <div className="tls-print-toolbar md:sticky md:top-0 z-20 border-b border-white/10 bg-[#0A0A0A]/95 backdrop-blur-sm" data-testid="print-toolbar">
        <div className="mx-auto max-w-[1180px] px-4 py-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link to={backTo} className="tls-btn tls-btn--quiet inline-flex min-h-11 shrink-0 items-center gap-2 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Zurück
              </Link>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/55">Druckansicht</div>
                <div className="truncate font-bold">{name || "…"}</div>
              </div>
            </div>
            <button type="button" onClick={() => window.print()} disabled={!printable} data-testid="print-button" className="tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 px-5 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              <Printer className="w-4 h-4" aria-hidden="true" /> Drucken
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <legend className="sr-only">Was gedruckt wird</legend>
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/55" aria-hidden="true">Teile</span>
              {partOptions.map((part) => (
                <label key={part.key} className="inline-flex min-h-11 items-center gap-2 text-sm text-white/85 cursor-pointer">
                  <input type="checkbox" checked={parts.includes(part.key)} onChange={() => togglePart(part.key)} data-testid={`print-part-${part.key}`} className="h-4 w-4 accent-[var(--tls-cyan)]" />
                  {part.label}
                </label>
              ))}
            </fieldset>
            {scope === "tournament" ? (
              <Choice legend="Baum" name="baum" value={ORIENTATION_PARAM[treeOrientation]} options={[["quer", "Quer"], ["hoch", "Hoch"]]} onChange={(value) => update({ baum: value })} />
            ) : null}
            <Choice legend="Listen" name="listen" value={ORIENTATION_PARAM[listOrientation]} options={[["hoch", "Hoch"], ["quer", "Quer"]]} onChange={(value) => update({ listen: value })} />
            {scope === "tournament" && parts.includes("spielplan") ? (
              <Choice legend="Spielplan" name="plan" value={scheduleOrder === "station" ? "station" : "zeit"} options={[["zeit", "Nach Zeit"], ["station", "Nach Station"]]} onChange={(value) => update({ plan: value })} />
            ) : null}
          </div>
          <p className="text-xs text-white/60">
            {sheets.length ? `${sheets.length} ${sheets.length === 1 ? "Seite" : "Seiten"} A4 · ${stamp}. ` : ""}
            Am Handy öffnet „Drucken“ das Druck- bzw. Teilen-Menü – dort als PDF sichern oder an den Drucker schicken.
          </p>
          {listError ? <p className="text-sm text-white/85 border border-white/20 rounded-sm px-3 py-2" role="alert" data-testid="print-list-error">{listError}</p> : null}
        </div>
      </div>

      {error ? <p className="mx-auto max-w-[1180px] px-4 py-8 text-white/85" role="alert" data-testid="print-error">{error}</p> : null}
      {!error && !data ? <p className="mx-auto max-w-[1180px] px-4 py-8 text-white/60" data-testid="print-loading">Druckansicht wird vorbereitet …</p> : null}
      {data && !sheets.length && !error ? (
        <p className="mx-auto max-w-[1180px] px-4 py-8 text-white/70" data-testid="print-nothing">{wantsList && staff && !list && !listError ? "Check-in-Liste wird geladen …" : "Nichts ausgewählt – oben mindestens einen Teil anhaken."}</p>
      ) : null}

      <div className="tls-print-desk" data-testid="print-sheets">
        {sheets.map((sheet, index) => {
          const zoom = Math.min(1, available / (PAPER[sheet.orientation].width * MM_TO_PX));
          return (
              <PrintSheet
                key={`${sheet.kind}-${index}`}
                zoom={zoom}
                orientation={sheet.orientation}
                kicker={KICKER[sheet.kind]}
                title={name}
                meta={meta}
                stamp={stamp}
                qrUrl={`${origin}${sheet.qrPath}`}
                qrLabel={sheet.qrLabel}
                page={index + 1}
                pages={sheets.length}
                testId={`print-sheet-${sheet.kind}`}
              >
                {sheet.empty ? <p className="tls-print-empty">{EMPTY_TEXT[sheet.kind]}</p> : null}
                {!sheet.empty && sheet.kind === "baum" ? <TreeBody page={sheet.page} /> : null}
                {!sheet.empty && sheet.kind === "spielplan" ? <ScheduleBody page={sheet.page} /> : null}
                {!sheet.empty && sheet.kind === "liste" ? <CheckinBody page={sheet.page} extraLabel={scope === "event" ? "Begleitung" : "Station"} /> : null}
                {!sheet.empty && sheet.kind === "tagesplan" ? <DayPlanBody page={sheet.page} /> : null}
              </PrintSheet>
          );
        })}
      </div>
    </div>
  );
}
