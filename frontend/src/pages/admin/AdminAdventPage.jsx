import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CalendarHeart, Copy, ExternalLink, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { INPUT_CLASS } from "@/components/tls/FormFields";
import { KIND_ICONS } from "@/advent/Door";
import { opensLabel } from "@/advent/doors";
import { CalendarPreview } from "./advent/CalendarPreview";
import { DoorEditor } from "./advent/DoorEditor";
import { RafflePanel, drawQuestion } from "./advent/RafflePanel";
import { dayText, defaultYear, yearOptions } from "./advent/form";

// Adventkalender pflegen (#641): 24 Türchen je Jahr anlegen, ansehen, kopieren - mit den Zahlen je Türchen und
// der Ziehung bei Gewinnen. Alles zum Kalender steht auf dieser einen Seite; ein- und ausgeschaltet wird er unter
// Auftritt → Jahreszeiten.

function errorText(failure, fallback) {
  return formatApiError(failure?.response?.data?.detail) || fallback;
}

function Tile({ label, value, tone = "text-white", testId }) {
  return (
    <div className="rounded-sm border border-white/10 bg-[#121212] p-4" data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">{label}</div>
      <div className={`mt-1.5 font-heading text-2xl font-black tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

/** Die Zahlen eines Türchens in einem Satz - ohne Namen. */
export function statsText(stats, kind) {
  if (!stats || (!stats.opened && !stats.views)) return "Noch nicht geöffnet";
  const parts = [`${stats.opened} ${stats.opened === 1 ? "Person" : "Personen"} mit Konto`];
  if (stats.opened) parts.push(`${stats.same_day} am Tag selbst, ${stats.later} nachgeholt`);
  parts.push(`${stats.views} ${stats.views === 1 ? "Aufruf" : "Aufrufe"} insgesamt`);
  if (kind === "quiz") parts.push(`${stats.quiz_done} beim Quiz dabei`);
  return parts.join(" · ");
}

function DayRow({ year, item, kinds, busy, onEdit, onDelete, onDraw, onRedraw }) {
  const { day, door, problem, stats, raffle } = item;
  const Icon = door ? KIND_ICONS[door.kind] : null;
  const kindLabel = door ? kinds.find((kind) => kind.key === door.kind)?.label || door.kind : "";
  return (
    <li className={`rounded-sm border bg-[#121212] p-4 ${door ? "border-white/10" : "border-dashed border-white/15"}`} data-testid={`advent-admin-day-${day}`} data-filled={door ? "1" : "0"}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#e9c46a]/50 bg-[#0A0A0A] font-serif text-lg font-semibold text-[#e9c46a]" style={{ fontFamily: 'Georgia, "Noto Serif", "Times New Roman", serif' }} aria-hidden="true">{day}</div>
        <div className="min-w-[11rem] flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/45">{dayText(year, day)}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider ${item.is_open ? "text-[#5fd38d]" : "text-white/35"}`}>{item.is_open ? "offen" : `öffnet ${opensLabel(item.opens_at)}`}</span>
          </div>
          {door ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {Icon && <Icon className="h-4 w-4 shrink-0 text-[#e9c46a]" aria-hidden="true" />}
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#e9c46a]">{kindLabel}</span>
                <span className="min-w-0 break-words font-bold text-white" data-testid={`advent-admin-title-${day}`}>{door.title}</span>
              </div>
              {door.copied_from && <div className="mt-0.5 text-xs text-white/40">Übernommen aus {door.copied_from}</div>}
            </>
          ) : (
            <div className="mt-1 text-sm text-white/50">Noch nichts eingetragen</div>
          )}
          {problem && (
            <div className="mt-2 flex items-start gap-2 text-xs text-[#ffd98a]" data-testid={`advent-admin-problem-${day}`}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span>{problem}</span>
            </div>
          )}
          <div className="mt-2 text-xs text-white/45" data-testid={`advent-admin-stats-${day}`}>{statsText(stats, door?.kind)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:pl-[3.75rem]">
          <button type="button" onClick={() => onEdit(day)} disabled={busy} data-testid={`advent-admin-edit-${day}`} className="inline-flex items-center gap-1.5 rounded-sm border border-white/15 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white/80 transition hover:border-[#e9c46a]/60 hover:text-[#e9c46a] disabled:opacity-40">
            {door ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {door ? "Bearbeiten" : "Anlegen"}
          </button>
          {door && (
            <button type="button" onClick={() => onDelete(item)} disabled={busy} aria-label={`Türchen ${day} leeren`} title="Türchen leeren" data-testid={`advent-admin-delete-${day}`} className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-white/10 text-white/45 transition hover:border-[#FF3B30]/50 hover:text-[#FF3B30] disabled:opacity-40">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {door?.kind === "prize" && <RafflePanel day={day} raffle={raffle} isOpen={item.is_open} busy={busy} onDraw={onDraw} onRedraw={onRedraw} />}
    </li>
  );
}

export default function AdminAdventPage() {
  const confirm = useConfirm();
  const [year, setYear] = useState(() => defaultYear());
  const [data, setData] = useState(null);
  const [options, setOptions] = useState({ news: [], events: [], members: [], stickers: [], audiences: [], max_winners: 20 });
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(false);

  const load = useCallback(async (target = year) => {
    try {
      const { data: result } = await api.get(`/seasonal/advent/admin/${target}`, { skipInvalidation: true });
      setData(result);
      setFailed("");
      return result;
    } catch (failure) {
      setFailed(errorText(failure, "Der Adventkalender lässt sich gerade nicht laden."));
      return null;
    }
  }, [year]);

  useEffect(() => {
    setData(null);
    load(year);
  }, [year, load]);
  useEffect(() => {
    api.get("/seasonal/advent/admin/options", { skipInvalidation: true }).then(({ data: result }) => setOptions(result)).catch(() => {});
  }, []);

  const run = async (action, success, fallback) => {
    if (busy) return fallback;
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      await load();
      return "";
    } catch (failure) {
      const message = errorText(failure, fallback);
      toast.error(message);
      return message;
    } finally {
      setBusy(false);
    }
  };

  const save = async (day, payload) => {
    const failure = await run(() => api.put(`/seasonal/advent/admin/${year}/${day}`, payload), `Türchen ${day} gespeichert.`, "Das Türchen konnte nicht gespeichert werden.");
    if (!failure) setEditing(null);
    return failure;
  };

  const remove = async (item) => {
    const approved = await confirm({
      title: `Türchen ${item.day} leeren?`,
      description: item.stats?.opened
        ? `„${item.door.title}“ wird entfernt. ${item.stats.opened === 1 ? "Eine Person hat" : `${item.stats.opened} Personen haben`} das Türchen schon geöffnet – es gilt für sie weiter als geöffnet, zeigt aber nur noch den Gruß des Löwen.`
        : `„${item.door.title}“ wird entfernt. An diesem Tag grüßt dann nur der Löwe.`,
      confirmLabel: "Leeren",
    });
    if (approved) await run(() => api.delete(`/seasonal/advent/admin/${year}/${item.day}`), `Türchen ${item.day} ist leer.`, "Das Türchen konnte nicht geleert werden.");
  };

  const copy = async () => {
    const source = year - 1;
    const approved = await confirm({
      title: `Türchen aus ${source} übernehmen?`,
      description: `Übernommen wird nur in leere Tage – was für ${year} schon eingetragen ist, bleibt. Zahlen und Verlosungen wandern nicht mit; „Mitglied der Woche“ und „Gewinn“ müssen für ${year} neu bestätigt werden.`,
      confirmLabel: "Übernehmen",
    });
    if (!approved) return;
    let result = null;
    const failure = await run(async () => {
      result = (await api.post(`/seasonal/advent/admin/${year}/copy`, { source_year: source })).data;
    }, "", `Aus ${source} ließ sich nichts übernehmen.`);
    if (!failure && result) {
      const copied = result.copied.length === 1 ? "1 Türchen übernommen" : `${result.copied.length} Türchen übernommen`;
      const skipped = result.skipped.length ? `, ${result.skipped.length} schon belegt` : "";
      const again = result.reconfirm.length ? ` – bitte neu bestätigen: ${result.reconfirm.join(", ")}` : "";
      toast.success(`${copied}${skipped}${again}.`);
    }
  };

  const draw = async (day, raffle) => {
    const item = data.doors.find((entry) => entry.day === day);
    const approved = await confirm({ title: `Verlosung zu Türchen ${day} ziehen?`, description: drawQuestion(raffle, item?.is_open), confirmLabel: "Jetzt ziehen" });
    if (approved) await run(() => api.post(`/seasonal/advent/admin/${year}/${day}/draw`, { close_early: Boolean(raffle.needs_close_early) }), `Türchen ${day}: gezogen. Die Gewinner sind benachrichtigt.`, "Die Ziehung hat nicht geklappt.");
  };

  const redraw = async (day, _raffle, winner) => {
    const approved = await confirm({
      title: "Ersatz ziehen?",
      description: `Der Gewinn von ${winner.name} ist verfallen. Unter allen, die noch nicht gewonnen haben, wird ein Ersatz gezogen und sofort benachrichtigt.`,
      confirmLabel: "Nachziehen",
    });
    if (approved) await run(() => api.post(`/seasonal/advent/admin/${year}/${day}/redraw`, { pickup_id: winner.pickup_id }), `Türchen ${day}: nachgezogen.`, "Das Nachziehen hat nicht geklappt.");
  };

  const years = useMemo(() => yearOptions(data?.years), [data?.years]);
  const problems = (data?.doors || []).filter((item) => item.door && item.problem).length;
  const hasLastYear = (data?.years || []).includes(year - 1);
  const edited = editing === null ? null : data?.doors.find((item) => item.day === editing) || null;

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-6xl" data-testid="advent-admin">
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#e9c46a]"><CalendarHeart className="h-4 w-4" /> Content</span>
            <h1 className="mt-1 font-heading text-3xl font-black uppercase md:text-4xl">Adventkalender</h1>
            <p className="mt-2 max-w-3xl text-sm text-white/60">
              24 Türchen je Jahr. Jedes geht an seinem Tag um {data?.door_hour || 6} Uhr auf und lässt sich bis 6. Jänner nachholen. Ein Tag ohne Eintrag zeigt den Gruß des Löwen; ohne ein einziges Türchen gibt es in dem Jahr keinen Kalender. Ein- und ausschalten lässt er sich unter <Link to="/admin/settings/jahreszeiten" className="text-[#29B6E8] hover:underline">Auftritt → Jahreszeiten</Link>.
            </p>
          </div>
          <label className="block w-32">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/60">Jahr</span>
            <select value={year} onChange={(event) => { setEditing(null); setYear(Number(event.target.value)); }} className={INPUT_CLASS} data-testid="advent-admin-year">
              {years.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </label>
        </div>

        {failed && <div className="mb-6 rounded-sm border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-4 py-3 text-sm text-[#ffb4ae]" role="alert" data-testid="advent-admin-error">{failed}</div>}
        {!data && !failed && <div className="py-16 text-center text-sm text-white/45" role="status">Lade Adventkalender …</div>}

        {data && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Angelegt" value={`${data.filled} von ${data.total}`} tone={data.filled === data.total ? "text-[#5fd38d]" : "text-white"} testId="advent-admin-filled" />
              <Tile label="Hinweise" value={problems} tone={problems ? "text-[#ffd98a]" : "text-white/60"} testId="advent-admin-problems" />
              <Tile label="Personen dabei" value={data.people} testId="advent-admin-people" />
              <Tile label="Stand" value={data.running ? "läuft" : data.filled ? "bereit" : "leer"} tone={data.running ? "text-[#5fd38d]" : "text-white/60"} testId="advent-admin-state" />
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setPreview(true)} disabled={!data.filled} data-testid="advent-admin-preview" className="inline-flex items-center gap-2 rounded-sm bg-[#e9c46a] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-black transition hover:opacity-90 disabled:opacity-40">
                <Eye className="h-3.5 w-3.5" /> Vorschau
              </button>
              {hasLastYear && (
                <button type="button" onClick={copy} disabled={busy} data-testid="advent-admin-copy" className="inline-flex items-center gap-2 rounded-sm border border-white/15 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white/80 transition hover:border-white/30 disabled:opacity-40">
                  <Copy className="h-3.5 w-3.5" /> Aus {year - 1} übernehmen
                </button>
              )}
              {data.running && (
                <Link to="/advent" className="inline-flex items-center gap-2 rounded-sm border border-white/15 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white/80 transition hover:border-white/30" data-testid="advent-admin-open">
                  <ExternalLink className="h-3.5 w-3.5" /> Zur Seite
                </Link>
              )}
              {!data.filled && <span className="text-xs text-white/45">Die Vorschau gibt es ab dem ersten Türchen.</span>}
            </div>

            <ol className="space-y-3" data-testid="advent-admin-days">
              {data.doors.map((item) => (
                <DayRow key={item.day} year={year} item={item} kinds={data.kinds} busy={busy} onEdit={setEditing} onDelete={remove} onDraw={draw} onRedraw={redraw} />
              ))}
            </ol>
          </>
        )}

        {edited && (
          <DoorEditor key={`${year}-${edited.day}`} year={year} day={edited.day} door={edited.door} kinds={data.kinds} options={options} locked={edited.raffle?.status === "drawn"} saving={busy} onSave={save} onClose={() => setEditing(null)} />
        )}
        {preview && data && <CalendarPreview year={year} doors={data.doors} onClose={() => setPreview(false)} />}
      </div>
    </AdminLayout>
  );
}
