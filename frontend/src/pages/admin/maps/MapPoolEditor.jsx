// Pool-Editor der Verwaltung (#1616) - für Turnier, Phase und Saison einer Referenzen-Serie. Je Modus des Spiels nur
// die dort freigegebenen, aktiven Maps; gewählte zuerst in ihrer Reihenfolge (Pfeile), dann die übrigen. Knöpfe:
// Vorgabe des Spiels übernehmen (Standard-Pool, sonst alle aktiven), aus einer Quelle kopieren (anderes Turnier oder
// Season → Turnier, Turnier → Phase, Vorsaison → Saison), alle abwählen,
// Speichern (neue Version, mit der geladenen Version gegen gleichzeitiges Überschreiben) und Pool entfernen.
// Gespeichert ist ein Snapshot: was sich in der Bibliothek seither geändert hat, steht als Hinweis da und kommt erst mit
// dem nächsten Speichern in den Pool. Die Regeln prüft der Server noch einmal (services/map_pools.py).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Map as MapIcon, Trash2 } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { ModeIcon } from "@/components/tls/ModeIcon";
import { viennaDate } from "@/lib/vienna";
import { modeStatusOf, selectableModes } from "@/lib/gameMatchData";
import { gamePageUrl } from "@/lib/gameForm";
import {
  choosableMaps,
  defaultSelection,
  eligibleMaps,
  mapStatusOf,
  mapsWithoutMode,
  moveMap,
  outdatedGroups,
  poolSelection,
  sameSelection,
  selectionBody,
  selectionCount,
  toggleMap,
} from "@/lib/mapPools";
import "@/components/tls/maps/maps.css";

const keyOf = (mode) => mode ?? "";
const ORIGIN_TEXT = { tournament: "Pool des Turniers", stage: "eigener Pool der Phase", reference_series: "Pool der Saison",
  league_season: "Pool der Liga-Season", game_default: "Standard-Pool des Spiels" };

// Wo Modi wieder aktiviert werden (#2249): auf der Spielseite im Reiter Modi - als Link, wo der Editor zur Bibliothek führen darf.
function ModesPlace({ game, libraryLink }) {
  if (!libraryLink) return <>auf der Spielseite im Reiter Modi</>;
  return <>auf der <Link to={gamePageUrl(game.id, "modi")} className="text-[#29B6E8] hover:text-white underline-offset-2 hover:underline" data-testid="pool-modes-link">Spielseite im Reiter Modi</Link></>;
}

/** Die Auswahl eines gespeicherten Pools, beschränkt auf das, was heute noch wählbar ist (aktiv, im Modus frei). */
function startSelection(entry, library, modes) {
  if (!entry || entry.stale) return {};
  const saved = poolSelection(entry);
  const groups = modes.length ? modes : [{ mode: null }];
  return Object.fromEntries(groups.map(({ mode }) => {
    const allowed = new Set(eligibleMaps(library, mode).map((item) => item.id));
    return [keyOf(mode), (saved[keyOf(mode)] || []).filter((id) => allowed.has(id))];
  }));
}

function Thumb({ item }) {
  return (
    <span className="relative w-12 shrink-0 overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A]" style={{ aspectRatio: "16 / 9" }} aria-hidden="true">
      {item.image_url ? (
        <LazyImg src={item.image_url} alt="" sizes="48px" widths={[160]} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[#29B6E8]/40"><MapIcon className="w-3.5 h-3.5" /></span>
      )}
    </span>
  );
}

function ModeGroup({ mode, label, icon, iconChanged = false, library, selected, kept = [], onToggle, onMove, disabled, testId }) {
  // Inaktive Maps (#2207) nur, wo der gespeicherte Pool sie in diesem Modus schon hat.
  const choices = choosableMaps(library, mode, kept);
  const byId = Object.fromEntries(choices.map((item) => [item.id, item]));
  const ordered = [...selected.filter((id) => byId[id]).map((id) => byId[id]), ...choices.filter((item) => !selected.includes(item.id))];
  const name = label || "Alle Maps";
  return (
    <fieldset className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3" data-testid={`${testId}-mode-${mode ?? "alle"}`}>
      <legend className="inline-flex items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-widest text-white/70">
        {/* Modus-Symbol (#2266): das des Spiels - beim Speichern kommt es als Schnappschuss in den Pool. */}
        {mode ? <ModeIcon src={icon} size="sm" testId={`${testId}-mode-${mode}-icon`} /> : null}
        {name} <span className="ml-1 normal-case tracking-normal font-semibold text-white/45 tabular-nums">{selected.length} von {choices.length}</span>
      </legend>
      {iconChanged ? (
        <p role="status" className="mb-2 text-xs text-white/60" data-testid={`${testId}-mode-${mode}-icon-changed`}>
          Symbol geändert – mit dem nächsten Speichern übernommen.
        </p>
      ) : null}
      {choices.length === 0 ? (
        <p className="text-xs text-white/45">Keine aktive Map ist für diesen Modus freigegeben.</p>
      ) : (
        <ul className="space-y-1">
          {ordered.map((item) => {
            const position = selected.indexOf(item.id);
            const on = position >= 0;
            return (
              <li key={item.id} data-testid={`${testId}-map-${keyOf(mode) || "alle"}-${item.id}`} data-map-id={item.id}
                className={`tls-map-pick flex items-center gap-2 rounded-sm border px-2 py-1.5 ${on ? "border-[#29B6E8]/50 bg-[#29B6E8]/[0.07]" : "border-transparent"}`}>
                <span className={`w-5 text-right text-[11px] font-bold tabular-nums ${on ? "text-[#29B6E8]" : "text-transparent"}`} aria-hidden="true">{on ? position + 1 : "–"}</span>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-white/85">
                  <input type="checkbox" checked={on} disabled={disabled} onChange={() => onToggle(mode, item.id)} aria-label={`${item.name} in ${name}`} className="accent-[#29B6E8]" />
                  <Thumb item={item} />
                  <span className="truncate">{item.name}</span>
                  {mapStatusOf(item) === "inactive" ? (
                    <span className="shrink-0 rounded-sm bg-white/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/55" data-testid={`${testId}-inactive-${item.id}`}>inaktiv</span>
                  ) : null}
                </label>
                {on ? (
                  <span className="flex shrink-0 items-center">
                    <button type="button" disabled={disabled || position === 0} onClick={() => onMove(mode, item.id, -1)} aria-label={`${item.name} in ${name} nach oben`}
                      className="p-1.5 text-white/50 hover:text-[#29B6E8] disabled:opacity-25 disabled:hover:text-white/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm">
                      <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" disabled={disabled || position === selected.length - 1} onClick={() => onMove(mode, item.id, 1)} aria-label={`${item.name} in ${name} nach unten`}
                      className="p-1.5 text-white/50 hover:text-[#29B6E8] disabled:opacity-25 disabled:hover:text-white/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm">
                      <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

export function MapPoolEditor({ title, hint = "", game, library = [], entry = null, sources = [], defaultPool = null, onSave, onClear, canEdit = true,
  libraryLink = false, defaultsLabel = "Vorgabe des Spiels", testId = "map-pool-editor" }) {
  const allModes = useMemo(() => game?.modes || [], [game]);
  // Inaktive und archivierte Modi (#2206) kommen in keinen neuen Pool - nur, was der gespeicherte Pool schon hat, bleibt zur Wahl.
  const kept = useMemo(() => (entry && !entry.stale ? (entry.modes || []).filter((group) => (group.maps || []).length).map((group) => group.mode) : []), [entry]);
  const modes = useMemo(() => selectableModes(allModes, kept), [allModes, kept]);
  const hiddenInactive = allModes.filter((mode) => modeStatusOf(mode) === "inactive" && !kept.includes(mode.mode));
  const [selection, setSelection] = useState(() => startSelection(entry, library, modes));
  const [busy, setBusy] = useState(false);
  const baseline = useMemo(() => (entry && !entry.stale ? poolSelection(entry) : {}), [entry]);
  const dirty = !sameSelection(baseline, selection) || Boolean(entry?.stale);
  const count = selectionCount(selection);
  const disabled = !canEdit || busy;
  // Hat das Spiel Modi, aber keiner ist wählbar, gibt es keine Gruppe „Alle Maps“ - der Server nähme sie nicht an.
  const groups = modes.length ? modes : allModes.length ? [] : [{ mode: null, label: "" }];
  const noModeLeft = groups.length === 0;
  const outdated = (entry?.outdated_map_ids || []).length && !entry?.stale
    ? (entry.modes || []).flatMap((group) => group.maps || []).filter((item, index, all) =>
      entry.outdated_map_ids.includes(item.map_id) && all.findIndex((other) => other.map_id === item.map_id) === index)
    : [];
  // #2129, SP2: Ein entfernter Modus bleibt im gespeicherten Pool lesbar und gilt weiter; Maps ohne Modus nennt der Hinweis.
  const oldGroups = outdatedGroups(entry, allModes);
  const withoutMode = mapsWithoutMode(library, allModes);

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => onSave(selectionBody(selection, modes, entry && !entry.stale ? entry.version : 0)));
  const clear = () => run(async () => {
    const done = await onClear?.();
    if (done !== false) setSelection({});
  });
  const copyFrom = (key) => {
    const source = sources.find((item) => item.key === key);
    if (source) setSelection(startSelection({ ...source.pool, stale: false }, library, modes));
  };
  // Vorgabe des Spiels (#2129, SP3): der Standard-Pool, soweit seine Maps heute wählbar sind - sonst wie bisher alle aktiven.
  const loadDefaults = () => {
    const fromDefault = defaultPool ? startSelection({ ...defaultPool, stale: false }, library, modes) : null;
    setSelection(fromDefault && selectionCount(fromDefault) ? fromDefault : defaultSelection(library, modes));
  };

  let status = "Noch kein Pool";
  if (entry) {
    status = `Version ${entry.version}${entry.saved_at ? ` · gespeichert am ${viennaDate(entry.saved_at, { day: "2-digit", month: "2-digit", year: "numeric" })}` : ""}`;
  }

  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4 space-y-3" aria-label={title} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">{title}</h3>
          {hint ? <p className="mt-0.5 text-xs text-white/50">{hint}</p> : null}
        </div>
        <div className="text-right text-[11px] text-white/55 tabular-nums" data-testid={`${testId}-status`}>
          {status}
          {entry && ORIGIN_TEXT[entry.origin] ? <div className="text-white/40">{ORIGIN_TEXT[entry.origin]}</div> : null}
        </div>
      </div>

      {!game ? (
        <p className="text-sm text-white/55" data-testid={`${testId}-no-game`}>Ohne Spiel gibt es keinen Map-Pool. Freitext bei Maps bleibt möglich.</p>
      ) : library.length === 0 ? (
        <p className="text-sm text-white/55" data-testid={`${testId}-no-maps`}>
          Für {game.name} gibt es noch keine aktiven Maps.
          {libraryLink ? <> <Link to={gamePageUrl(game.id, "maps")} className="text-[#29B6E8] hover:text-white underline-offset-2 hover:underline">Maps anlegen</Link></> : null}
        </p>
      ) : null}

      {entry?.stale ? (
        <p role="status" className="rounded-sm border border-[#FFD700]/30 bg-[#FFD700]/5 px-3 py-2 text-xs text-[#FFD700]" data-testid={`${testId}-stale`}>
          Der gespeicherte Pool gehört zu einem anderen Spiel und gilt nicht mehr. Bitte neu wählen – Spiele, die ihn schon festhalten, behalten ihn.
        </p>
      ) : null}
      {outdated.length ? (
        <p role="status" className="rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/70" data-testid={`${testId}-outdated`}>
          Seit dem Speichern in der Bibliothek geändert: {outdated.map((item) => item.name).join(", ")}. Gespeichert bleibt der alte Stand, bis du neu speicherst.
        </p>
      ) : null}
      {oldGroups.length ? (
        <p role="status" className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn" data-testid={`${testId}-old-groups`}>
          Im gespeicherten Pool steht noch {oldGroups.map((group) => `„${group.label || group.mode || "Alle Maps"}“ (${(group.maps || []).length})`).join(", ")} – so hat das Spiel das nicht mehr. Der Pool gilt unverändert weiter, Spiele melden weiter daraus. Erst neues Speichern ersetzt ihn durch die Auswahl unten.
        </p>
      ) : null}
      {game && library.length > 0 && noModeLeft ? (
        <p role="status" className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn" data-testid={`${testId}-no-modes`}>
          Kein Modus von {game.name} steht für einen neuen Pool zur Wahl – alle sind inaktiv oder archiviert. Aktivieren <ModesPlace game={game} libraryLink={libraryLink} />.
        </p>
      ) : null}
      {game && hiddenInactive.length ? (
        <p role="status" className="rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/70" data-testid={`${testId}-inactive`}>
          Inaktiv und hier nicht zur Wahl: {hiddenInactive.map((mode) => `„${mode.label || mode.mode}“`).join(", ")}. Wieder aktivieren <ModesPlace game={game} libraryLink={libraryLink} />.
        </p>
      ) : null}
      {game && withoutMode.length ? (
        <p role="status" className="rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/70" data-testid={`${testId}-without-mode`}>
          {withoutMode.length === 1 ? "1 Map hat" : `${withoutMode.length} Maps haben`} noch keinen Modus und {withoutMode.length === 1 ? "steht" : "stehen"} hier nicht zur Wahl.
          {libraryLink ? <> <Link to={gamePageUrl(game.id, "maps")} className="text-[#29B6E8] hover:text-white underline-offset-2 hover:underline">Zuordnen</Link></> : " Zuordnen auf der Spielseite im Reiter Maps."}
        </p>
      ) : null}

      {game && library.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={disabled || noModeLeft} onClick={loadDefaults} data-testid={`${testId}-defaults`}
              title={defaultPool ? "Lädt den Standard-Pool des Spiels" : "Lädt alle aktiven Maps des Spiels"}
              className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
              {defaultsLabel}
            </button>
            {sources.length ? (
              <select value="" disabled={disabled || noModeLeft} onChange={(event) => copyFrom(event.target.value)} data-testid={`${testId}-copy`} aria-label="Pool übernehmen von"
                className="bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-2 py-1.5 rounded-sm text-xs text-white focus:outline-none">
                <option value="">Übernehmen von …</option>
                {sources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
              </select>
            ) : null}
            <button type="button" disabled={disabled || count === 0} onClick={() => setSelection({})} data-testid={`${testId}-none`}
              className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
              Alle abwählen
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {groups.map(({ mode, label, icon_url: icon }) => (
              <ModeGroup key={keyOf(mode) || "alle"} mode={mode} label={label} icon={icon} library={library}
                iconChanged={Boolean(mode) && !entry?.stale && (entry?.outdated_modes || []).includes(mode)} selected={selection[keyOf(mode)] || []}
                kept={baseline[keyOf(mode)] || []}
                onToggle={(m, id) => setSelection((current) => toggleMap(current, m, id))}
                onMove={(m, id, delta) => setSelection((current) => moveMap(current, m, id, delta))}
                disabled={disabled} testId={testId} />
            ))}
          </div>
        </>
      ) : null}

      {canEdit && game ? (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {entry && onClear ? (
            <button type="button" disabled={busy} onClick={clear} data-testid={`${testId}-clear`}
              className="tls-btn tls-btn--danger px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Pool entfernen
            </button>
          ) : null}
          <button type="button" disabled={busy || !dirty || count === 0 || noModeLeft} onClick={save} data-testid={`${testId}-save`}
            className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
            {busy ? "Speichere …" : "Speichern"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
