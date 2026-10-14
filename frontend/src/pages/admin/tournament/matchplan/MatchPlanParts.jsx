import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Clock3, Pin, Wand2 } from "lucide-react";
import { durationSourceText, matchDurationSource, ownDurationInput, ownDurationPayload } from "@/lib/matchDuration";
import { countOf } from "@/lib/schedulePlanText";
import { motionTransition } from "@/lib/motion";
import { formatDeviceType } from "@/lib/tournamentLabels";
import { fromViennaInput, viennaDateTime, viennaInputValue, viennaTime } from "@/lib/vienna";

// Bausteine der Matchplan-Seite (#1557). Sie zeigen nur an, was der Planer gerechnet hat oder am Turnier steht.

const hm = (ms) => viennaTime(ms, { hour: "2-digit", minute: "2-digit" }) || "–";
const when = (value) => viennaDateTime(value, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) || "nicht gesetzt";

function Field({ label, hint, render }) {
  const id = useId();
  return (
    <div className="mp-field">
      <label className="mp-field__label" htmlFor={id}>{label}</label>
      {render({ id, "aria-describedby": hint ? `${id}-hint` : undefined })}
      {hint ? <span className="mp-field__hint" id={`${id}-hint`}>{hint}</span> : null}
    </div>
  );
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== "" ? Math.max(0, Math.trunc(parsed)) : null;
}

/** Oben: wann es losgeht, wie viel Luft zwischen und in den Spielen ist, wie lange ein Spiel dauert, welche Stationen. */
export function PlanSettings({ tournament, mode, duration, stations, canEdit, onSave, actions }) {
  const initial = {
    start: viennaInputValue(tournament.start_date),
    pause: String(tournament.match_break_minutes ?? 5),
    buffer: String(tournament.match_buffer_minutes ?? 0),
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const stamp = `${tournament.start_date}|${tournament.match_break_minutes}|${tournament.match_buffer_minutes}`;
  useEffect(() => {
    setForm({
      start: viennaInputValue(tournament.start_date),
      pause: String(tournament.match_break_minutes ?? 5),
      buffer: String(tournament.match_buffer_minutes ?? 0),
    });
    // Nur wenn sich das gespeicherte Turnier ändert, nicht bei jedem neuen Objekt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  const dirty = form.start !== initial.start || form.pause !== initial.pause || form.buffer !== initial.buffer;
  const local = mode === "local";

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    await onSave({
      // Turnierstart in Wiener Uhr - das Gerät kann woanders stehen (Zeitumstellung siehe lib/vienna).
      ...(form.start && fromViennaInput(form.start) ? { start_date: fromViennaInput(form.start) } : {}),
      match_break_minutes: number(form.pause) ?? 0,
      ...(local ? { match_buffer_minutes: number(form.buffer) ?? 0 } : {}),
    });
    setSaving(false);
  };

  return (
    <form className="mp-card mp-settings" data-testid="mp-settings" onSubmit={save}>
      <div className="mp-card__head">
        <h3 className="mp-card__title">Planung</h3>
        <span className="mp-card__note">{local ? "Vor Ort: Stationen, feste Uhrzeiten, Aufruf an der Station" : mode === "league" ? "Liga: Spielwochen mit Frist, keine Stationen" : "Online: keine Stationen, Fristen je Spiel"}</span>
      </div>
      {canEdit ? (
        <div className="mp-settings__grid">
          <Field label="Turnierstart" render={(props) => (
            <input {...props} type="datetime-local" className="mp-input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          )} />
          <Field label="Mindestpause zwischen zwei Spielen (Min.)" hint="So lange hat ein Spieler mindestens frei." render={(props) => (
            <input {...props} type="number" min="0" max="240" className="mp-input" value={form.pause} onChange={(e) => setForm({ ...form, pause: e.target.value })} />
          )} />
          {local && (
            <Field label="Puffer je Spiel (Min.)" hint="Luft, die auf jede Spieldauer kommt." render={(props) => (
              <input {...props} type="number" min="0" max="120" className="mp-input" value={form.buffer} onChange={(e) => setForm({ ...form, buffer: e.target.value })} />
            )} />
          )}
        </div>
      ) : (
        <dl className="mp-settings__grid">
          <div className="mp-field"><dt className="mp-field__label">Turnierstart</dt><dd>{when(tournament.start_date)}</dd></div>
          <div className="mp-field"><dt className="mp-field__label">Mindestpause</dt><dd>{tournament.match_break_minutes ?? 5} Min.</dd></div>
          {local && <div className="mp-field"><dt className="mp-field__label">Puffer je Spiel</dt><dd>{tournament.match_buffer_minutes ?? 0} Min.</dd></div>}
        </dl>
      )}
      <div className="mp-settings__facts">
        <span className="mp-fact"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Spieldauer {durationSourceText(duration)}</span>
      </div>
      {local && (
        <div className="mp-settings__stations">
          <span className="mp-field__label">Stationen</span>
          <ul className="mp-chips">
            {stations.map((station) => (
              <li key={station.id} className="mp-chip" data-status={station.status}>
                <span>{station.name}</span>
                <span className="mp-chip__meta">{formatDeviceType(station.device_type)}{station.scope === "event" ? " · Event" : ""}{station.status === "broken" ? " · defekt" : ""}</span>
              </li>
            ))}
            {!stations.length && <li className="mp-chip mp-chip--empty">Noch keine Station - ohne Station plant der Planer keine Zeiten.</li>}
          </ul>
          <Link to="/admin/stations" className="mp-link">Stationen verwalten</Link>
        </div>
      )}
      <div className="mp-settings__actions">
        {actions}
        {canEdit && (
          <button type="submit" disabled={!dirty || saving} className="tls-btn tls-btn--quiet mp-btn">
            {saving ? "Speichert …" : "Einstellungen speichern"}
          </button>
        )}
      </div>
    </form>
  );
}

/** „Automatisch planen“ ergibt eine Vorschau: was sich ändert, was nicht passt - erst „Übernehmen“ schreibt. */
export function PlanPreview({ plan, stale, busy, onApply, onDiscard }) {
  const reduce = useReducedMotion();
  const changed = (plan?.assignments || []).filter((item) => item.changed);
  const warnings = plan?.warnings || [];
  const errors = warnings.filter((item) => item.severity === "error");
  const hints = warnings.filter((item) => item.severity !== "error");
  const stations = plan?.mode === "stations" || plan?.mode === "mixed";
  const verb = changed.length === 1 ? "bekommt" : "bekommen";
  return (
    <AnimatePresence initial={!reduce}>
      {plan && (
        <motion.section
          key="preview"
          className="mp-preview"
          data-testid="mp-preview"
          aria-label="Vorschau des Planers"
          initial={reduce ? false : { opacity: 0, transform: "translateY(-6px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(-6px)" }}
          transition={motionTransition("mid")}
        >
          <div className="mp-preview__text">
            <span className="mp-preview__eyebrow"><Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> Vorschau</span>
            <p className="mp-preview__summary">
              {changed.length
                ? `${countOf(changed.length, "Spiel", "Spiele")} ${verb} Zeit${stations ? " und Station" : ""}`
                : "Nichts zu ändern: alle Spiele stehen schon so im Plan"}
              {`, ${countOf(errors.length, "Konflikt", "Konflikte")}, ${countOf(hints.length, "Hinweis", "Hinweise")}.`}
            </p>
            <p className="mp-preview__sub">Geänderte Spiele sind hell umrandet, gestrichelt steht, wo sie vorher lagen. Geschrieben wird erst mit „Übernehmen“.</p>
            {stale && <p className="mp-preview__stale" role="alert" data-testid="mp-preview-stale">{stale} Ich habe neu geplant - bitte prüfe die Vorschau noch einmal.</p>}
          </div>
          <div className="mp-preview__actions">
            <button type="button" className="tls-btn tls-btn--primary mp-btn" disabled={busy || !changed.length} onClick={onApply}>
              {busy ? "Übernimmt …" : "Übernehmen"}
            </button>
            <button type="button" className="tls-btn tls-btn--quiet mp-btn" disabled={busy} onClick={onDiscard}>Verwerfen</button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

/** Live: wie weit der Tag hinter dem gespeicherten Plan liegt - aus der Prognose des Planers. */
export function DelayBanner({ delay, onReplan, canPlan }) {
  if (!delay) return null;
  const late = delay.minutes > 0;
  return (
    <div className="mp-delay" data-testid="mp-delay" data-late={late ? "true" : "false"} role="status">
      <strong className="mp-delay__value">{late ? `+${delay.minutes}` : `−${Math.abs(delay.minutes)}`} Min.</strong>
      <span>
        {late ? "Verzug" : "Vorsprung"} - {delay.label} jetzt ca. {hm(delay.at)}
        <span className="mp-delay__sub"> statt {hm(delay.at - delay.minutes * 60_000)}.{canPlan ? " „Automatisch planen“ rückt die offenen Spiele nach; feste Termine bleiben." : ""}</span>
      </span>
      {canPlan && <button type="button" className="tls-btn tls-btn--secondary mp-btn" onClick={onReplan}>Nachrücken planen</button>}
    </div>
  );
}

/** Konflikte und Hinweise in Worten - vom Planer und aus Überschneidungen auf einer Bahn. */
export function PlanWarnings({ items, warnings }) {
  const fromItems = items.flatMap((item) => item.conflicts.filter((conflict) => conflict.type === "station_overlap").map((conflict) => conflict.text));
  const rows = [...new Set([...(warnings || []).map((warning) => warning.message), ...fromItems])].filter(Boolean);
  if (!rows.length) return null;
  return (
    <ul className="mp-warnings" data-testid="mp-warnings" aria-label="Konflikte und Hinweise">
      {rows.map((text) => (
        <li key={text}><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>{text}</span></li>
      ))}
    </ul>
  );
}

function stateText(item) {
  if (item.preview) return "noch ohne Zeit - Baum ist Vorschau";
  if (item.start === null || item.start === undefined) return "noch ohne Zeit";
  if (item.state === "running") return `läuft ${item.elapsedMinutes} Min.`;
  if (item.state === "done") return "erledigt";
  if (item.conflicts.length) return item.conflicts[0].text;
  if (item.fixed) return item.source === "accepted" ? "vereinbart - bleibt" : "fest - von Hand gesetzt";
  if (item.draw === "ready") return "wartet auf Auslosung - der Topf steht";
  if (item.draw === "waiting") return "wartet auf Auslosung";
  if (item.draw === "instant") return "Prognose - das Los entscheidet, Plätze füllen sich einzeln";
  if (item.forecast) return "Prognose - Spieler stehen noch nicht fest";
  return "vom Planer";
}

const TONE_LABEL = { wb: "WB", lb: "LB", final: "Finale", main: "Spiel" };

/** Die Reihenfolge als Liste: nach Zeit, mit Station, Dauer und Herkunft des Termins. */
export function OrderList({ items, laneNames, canEdit, onRelease, editor }) {
  const [open, setOpen] = useState(null);
  const editable = (item) => typeof canEdit === "function" ? canEdit(item) : Boolean(canEdit);
  return (
    <div className="mp-order-scroll">
      <table className="mp-order" data-testid="mp-order">
        <thead>
          <tr><th>#</th><th>Spiel</th><th>Zeit</th><th>Station</th><th>Dauer</th><th><span className="sr-only">Aktion</span></th></tr>
        </thead>
        <tbody>
          {items.map((item, index) => [
            <tr key={item.id} data-state={item.state} data-conflict={item.conflicts.length ? "true" : undefined}>
              <td className="mp-mono">{index + 1}</td>
              <td>
                <span className="mp-pill" data-tone={item.tone}>{TONE_LABEL[item.tone]}</span> <strong>{item.key}</strong>
                <span className="mp-order__why" data-warn={item.conflicts.length ? "true" : undefined}>{stateText(item)}</span>
              </td>
              <td className="mp-mono">{item.start === null || item.start === undefined ? "–" : `${hm(item.start)}–${hm(item.end)}`}</td>
              <td>{item.laneId === "none" ? "ohne Station" : laneNames[item.laneId]}</td>
              <td className="mp-mono">{item.minutes} Min.</td>
              <td>
                <span className="mp-order__actions">
                  {editable(item) && item.fixed && item.source === "manual" && item.state === "planned" && item.start !== null && (
                    <button type="button" className="tls-btn tls-btn--quiet mp-btn mp-btn--small" aria-label={`Termin von ${item.key} lösen`} onClick={() => onRelease(item)}>
                      <Pin className="h-3 w-3" aria-hidden="true" /> lösen
                    </button>
                  )}
                  {editor && editable(item) && !item.preview && item.state === "planned" && (
                    <button type="button" className="tls-btn tls-btn--quiet mp-btn mp-btn--small" aria-label={`${item.key} ändern`} aria-expanded={open === item.id}
                      onClick={() => setOpen(open === item.id ? null : item.id)}>
                      ändern
                    </button>
                  )}
                </span>
              </td>
            </tr>,
            open === item.id && editor ? (
              <tr key={`${item.id}-edit`} className="mp-order__editor"><td colSpan={6}>{editor(item, () => setOpen(null))}</td></tr>
            ) : null,
          ])}
          {!items.length && (
            <tr><td colSpan={6} className="mp-order__empty">Noch kein Spiel. „Automatisch planen“ zeigt, wann welches Spiel an welcher Station laufen kann.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Handy: je Station die Spiele untereinander - was jetzt läuft, was als Nächstes kommt. */
export function StationAgenda({ timeline, canEdit = false, onRelease, editor }) {
  const [open, setOpen] = useState(null);
  const editable = (item) => typeof canEdit === "function" ? canEdit(item) : Boolean(canEdit);
  const unscheduled = timeline.unscheduled || [];
  return (
    <div className="mp-agenda" data-testid="mp-agenda">
      {timeline.lanes.map((lane) => {
        const items = timeline.items.filter((item) => item.laneId === lane.id);
        const next = items.find((item) => item.state === "planned");
        return (
          <section key={lane.id} className="mp-agenda__lane" aria-label={lane.name}>
            <h4 className="mp-agenda__title">
              <span>{lane.name}</span>
              <span className="mp-agenda__count">{lane.status === "broken" ? "defekt · " : ""}{countOf(items.length, "Spiel", "Spiele")}</span>
            </h4>
            <ul className="mp-agenda__list">
              {items.map((item) => (
                <li key={item.id} className="mp-agenda__item" data-state={item.state} data-next={next?.id === item.id ? "true" : undefined}
                  data-conflict={item.conflicts.length ? "true" : undefined}>
                  <span className="mp-agenda__time mp-mono">{hm(item.start)}</span>
                  <span className="mp-agenda__body">
                    <span className="mp-agenda__key">
                      <span className="mp-pill" data-tone={item.tone}>{TONE_LABEL[item.tone]}</span> {item.key}
                      {item.fixed && <Pin className="h-3 w-3" aria-label="fester Termin" />}
                    </span>
                    <span className="mp-agenda__names">{item.names.join(" · ")}</span>
                    <span className="mp-agenda__state" data-warn={item.conflicts.length ? "true" : undefined}>
                      {next?.id === item.id && item.state === "planned" ? "als Nächstes · " : ""}{stateText(item)}
                    </span>
                    {editor && editable(item) && item.state === "planned" && !item.preview && (
                      <button type="button" className="tls-btn tls-btn--quiet mp-btn mp-btn--small mp-agenda__action" aria-label={`${item.key} ändern`}
                        aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? null : item.id)}>ändern</button>
                    )}
                    {open === item.id && editor ? editor(item, () => setOpen(null)) : null}
                    {editable(item) && onRelease && item.fixed && item.source === "manual" && item.state === "planned" && (
                      <button type="button" className="tls-btn tls-btn--quiet mp-btn mp-btn--small mp-agenda__action" aria-label={`Termin von ${item.key} lösen`} onClick={() => onRelease(item)}>
                        <Pin className="h-3 w-3" aria-hidden="true" /> Termin lösen
                      </button>
                    )}
                  </span>
                </li>
              ))}
              {!items.length && <li className="mp-agenda__empty">Keine Spiele an dieser Station.</li>}
            </ul>
          </section>
        );
      })}
      {unscheduled.length > 0 && (
        <section className="mp-agenda__lane" aria-label="Noch ohne Zeit">
          <h4 className="mp-agenda__title"><span>Noch ohne Zeit</span><span className="mp-agenda__count">{countOf(unscheduled.length, "Spiel", "Spiele")}</span></h4>
          <ul className="mp-agenda__list">
            {unscheduled.map((item) => (
              <li key={item.id} className="mp-agenda__item" data-state="open">
                <span className="mp-agenda__time mp-mono">–</span>
                <span className="mp-agenda__body">
                  <span className="mp-agenda__key"><span className="mp-pill" data-tone={item.tone}>{TONE_LABEL[item.tone]}</span> {item.key}</span>
                  <span className="mp-agenda__names">{item.names.join(" · ")}</span>
                  <span className="mp-agenda__state">{stateText(item)}</span>
                  {editor && editable(item) && !item.preview && item.state === "planned" && (
                    <button type="button" className="tls-btn tls-btn--quiet mp-btn mp-btn--small mp-agenda__action" aria-label={`${item.key} ändern`}
                      aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? null : item.id)}>ändern</button>
                  )}
                  {open === item.id && editor ? editor(item, () => setOpen(null)) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Ein Hinweis über dem Plan: warum (noch) nichts geplant wird, oder dass die Anfrage an den Planer scheiterte. */
export function PlanNotice({ tone = "info", testId, children }) {
  return <p className="mp-notice" data-tone={tone} data-testid={testId} role={tone === "error" ? "alert" : "status"}>{children}</p>;
}

/**
 * Ein Spiel von Hand: Start (Wiener Uhr), Station, eigene Dauer. Ersetzt die alte „Matchplanung“ an den Spielkarten im
 * Reiter „Spiele“. Leere Dauer erbt (daneben steht, woher), leerer Start gibt den Termin an den Planer zurück.
 */
export function MatchEditor({ item, match, stations, stage, tournament, game, onSave, onClose, withStation = true }) {
  const inherited = matchDurationSource(match ? { ...match, duration_minutes: null } : {}, { stage, tournament, game });
  const [start, setStart] = useState(viennaInputValue(match?.scheduled_at));
  const [stationId, setStationId] = useState(match?.station_id || "");
  const [duration, setDuration] = useState(ownDurationInput(match?.duration_minutes));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const id = useId();
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    const result = await onSave(item, {
      scheduled_at: start ? fromViennaInput(start) : null,
      // Online und Liga haben keine Station - das Feld fehlt, die Station bleibt, wie sie ist.
      ...(withStation ? { station_id: stationId || null } : {}),
      duration_minutes: ownDurationPayload(duration),
    });
    setBusy(false);
    if (result?.ok) onClose?.();
    else setMessage(result?.message || "Das Spiel konnte nicht gespeichert werden.");
  };
  return (
    <form className="mp-editor" data-testid="mp-editor" onSubmit={save} aria-label={`${item.key} ändern`}>
      <div className="mp-editor__grid">
        <div className="mp-field">
          <label className="mp-field__label" htmlFor={`${id}-start`}>Start</label>
          <input id={`${id}-start`} type="datetime-local" className="mp-input" value={start} onChange={(e) => setStart(e.target.value)} />
          <span className="mp-field__hint">Leer: der Planer plant das Spiel wieder.</span>
        </div>
        {withStation && <div className="mp-field">
          <label className="mp-field__label" htmlFor={`${id}-station`}>Station</label>
          <select id={`${id}-station`} className="mp-input" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">Ohne Station</option>
            {stations.map((station) => (
              <option key={station.id} value={station.id}>{station.name}{station.status === "broken" ? " (defekt)" : ""}</option>
            ))}
          </select>
        </div>}
        <div className="mp-field">
          <label className="mp-field__label" htmlFor={`${id}-duration`}>Eigene Dauer (Min.)</label>
          <input id={`${id}-duration`} type="number" min="1" className="mp-input" value={duration} placeholder={String(inherited.minutes)}
            onChange={(e) => setDuration(e.target.value)} aria-describedby={`${id}-duration-hint`} />
          <span className="mp-field__hint" id={`${id}-duration-hint`}>Leer lassen: {durationSourceText(inherited)}</span>
        </div>
      </div>
      {message && <p className="mp-editor__message" role="alert">{message}</p>}
      <div className="mp-editor__actions">
        <button type="submit" className="tls-btn tls-btn--primary mp-btn" disabled={busy}>{busy ? "Speichert …" : "Speichern"}</button>
        <button type="button" className="tls-btn tls-btn--quiet mp-btn" onClick={onClose} disabled={busy}>Abbrechen</button>
      </div>
    </form>
  );
}
