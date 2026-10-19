// Druckansicht (#1283): Plan B auf Papier für den Eventtag. Am Vorabend werden Baum, Spielplan, Check-in-Liste und
// Tagesplan gedruckt; fällt am Event Netz oder Server aus, läuft das Turnier auf dem Ausdruck weiter.
//
// Hier steht nur Rechnung: wie viel auf ein A4-Blatt passt und wie sich Baum und Listen auf Seiten verteilen. Alle Maße
// in Millimetern - die Seite zeichnet Karten und Zeilen in genau diesen Höhen (feste Höhe, Namen einzeilig mit „…“),
// deshalb kann nichts über den Rand laufen. Rundennamen kommen aus derselben Regel wie im Web-Baum (lib/bracketNames).
import { displayRoundLabels, roundName, treeSlotLabel } from "@/lib/bracketNames";
import { sectionKind } from "@/lib/bracketSections";
import { isCancelled, isDone } from "@/lib/bracketGraph";
import { describeSlot, finderFor } from "@/lib/slotSource";
import { formatBracketSection, stationText } from "@/lib/tournamentLabels";
import { groupByStation, scheduleEntries } from "@/lib/scheduleView";
import { dayIndexOf, eventDays, planItems } from "@/lib/tvDayPlan";
import { viennaDate, viennaTime } from "@/lib/vienna";

// ------------------------------------------------------------------------------------------------------- Teile, Seite

/** Die Teile der Druckansicht in der Reihenfolge auf dem Papier. `staff`: nur mit Turnier-Recht (Check-in-Liste). */
export const PRINT_PARTS = [
  { key: "baum", label: "Turnierbaum", scope: "tournament" },
  { key: "spielplan", label: "Spielplan", scope: "tournament" },
  { key: "tagesplan", label: "Tagesplan", scope: "event" },
  { key: "liste", label: "Check-in-Liste", scope: "both", staff: true },
];

/** Vorgaben, wenn die Adresse nichts sagt: Baum quer, Listen hoch, Spielplan nach Zeit. */
export const PRINT_DEFAULTS = { treeOrientation: "landscape", listOrientation: "portrait", scheduleOrder: "time" };

export const PAPER = {
  portrait: { width: 210, height: 297 },
  landscape: { width: 297, height: 210 },
};

/** Rahmen eines Blatts: Rand, Kopf, Fuß (Druckzeit und QR-Code) und die Abstände dazwischen. */
export const SHEET = { margin: 10, header: 14, footer: 20, gap: 4 };

/** Der Platz für den Inhalt eines Blatts. */
export function sheetBody(orientation = "portrait") {
  const paper = PAPER[orientation] || PAPER.portrait;
  return {
    width: paper.width - 2 * SHEET.margin,
    height: paper.height - 2 * SHEET.margin - SHEET.header - SHEET.footer - 2 * SHEET.gap,
  };
}

/** Längster Name, für den der Kopf ausgelegt ist (Turnier- und Event-Namen). */
export const TITLE_MAX = 80;

/**
 * Wie groß der Name im Kopf steht: „normal“ (14 pt, eine Zeile), „long“ (10,5 pt, bis zwei Zeilen) oder „longer“
 * (8,5 pt, bis drei Zeilen). Quer ist mehr Platz. Bis TITLE_MAX Zeichen fehlt so nie etwas (Abnahme prüft es).
 */
export function titleTier(title, orientation = "portrait") {
  const length = String(title || "").length;
  const [normal, long] = orientation === "landscape" ? [30, 60] : [22, 40];
  if (length <= normal) return "normal";
  if (length <= long) return "long";
  return "longer";
}

/** Welche Teile die Adresse wählt (`?teile=baum,liste`) - nur bekannte, in Papier-Reihenfolge, ohne Dopplung. */
export function parseParts(value, scope = "tournament", { staff = false } = {}) {
  const allowed = PRINT_PARTS.filter((part) => (part.scope === scope || part.scope === "both") && (!part.staff || staff));
  const wanted = new Set(String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  // „none“: bewusst alles abgewählt - dann bleibt es leer, statt wieder die Vorgabe zu zeigen.
  if (wanted.has("none")) return [];
  const picked = allowed.filter((part) => wanted.has(part.key)).map((part) => part.key);
  if (picked.length) return picked;
  // Ohne Auswahl: alles, was öffentlich ist - die Liste nur auf Wunsch.
  return allowed.filter((part) => !part.staff).map((part) => part.key);
}

/** „Stand 30.10. 19:12“ - Datum dazu, weil am Vorabend gedruckt wird. */
export function stampText(now = Date.now()) {
  return `Stand ${viennaDate(now, { day: "2-digit", month: "2-digit" })} ${viennaTime(now, { hour: "2-digit", minute: "2-digit" })}`;
}

// ------------------------------------------------------------------------------------------------------------- Baum

/** Maße im Baum: Abschnitts-Titel, Rundenkopf, Spalten-Abstand, kleinste Spaltenbreite, Karte (Kopf, Zeile, Rand). */
export const TREE = { blockTitle: 8, columnTitle: 7, columnGap: 6, minColumnWidth: 58, cardHead: 4.5, cardRow: 6, cardPad: 1, cardGap: 3 };

export function cardHeight(slotCount) {
  return TREE.cardHead + Math.max(1, slotCount) * TREE.cardRow + TREE.cardPad;
}

/** Wie viele Spalten (Runden) nebeneinander passen. */
export function treeColumns(orientation = "landscape") {
  const { width } = sheetBody(orientation);
  return Math.max(1, Math.floor((width + TREE.columnGap) / (TREE.minColumnWidth + TREE.columnGap)));
}

/** Wie hoch eine Spalte für Karten sein darf. */
export function treeColumnCapacity(orientation = "landscape") {
  return sheetBody(orientation).height - TREE.blockTitle - TREE.columnTitle;
}

/** Höhe einer Spalte mit diesen Karten (inklusive Mindestabstand). */
export function columnHeight(matches) {
  if (!matches.length) return 0;
  return matches.reduce((sum, match) => sum + cardHeight(match.slots.length), 0) + (matches.length - 1) * TREE.cardGap;
}

const SECTION_ORDER = { main: 0, group: 1, loser: 2, grand_final: 3, bronze: 4 };

function scoreOf(match, registrationId) {
  const row = (match.results || []).find((result) => result?.registration_id && result.registration_id === registrationId);
  if (!row) return "";
  if (row.score != null && row.score !== "" && Number.isFinite(Number(row.score))) return String(row.score);
  if (row.rank != null && Number(row.rank) > 0 && (match.slots || []).length > 2) return `${row.rank}.`;
  return "";
}

function winnerIdOf(match) {
  if (match.winner_id) return match.winner_id;
  const first = (match.results || []).filter((row) => Number(row?.rank) === 1);
  return first.length === 1 ? first[0].registration_id : null;
}

/** Eine Karte für Papier: Kürzel, Zeit, Station und die Plätze mit Namen - oder wer kommt („Sieger aus A“). */
export function printMatch(match, regMap, findMatch) {
  const done = isDone(match);
  const winnerId = done ? winnerIdOf(match) : null;
  const slots = [...(match.slots || [])].sort((a, b) => Number(a.slot ?? a.position ?? 0) - Number(b.slot ?? b.position ?? 0));
  const nameOf = (id) => {
    const reg = regMap.get(id);
    return reg ? (reg.display_name || reg.user?.display_name || reg.ingame_name || "-") : "";
  };
  return {
    id: match.id,
    key: String(match.match_key || ""),
    time: match.scheduled_at && !done ? viennaTime(match.scheduled_at, { hour: "2-digit", minute: "2-digit" }) : "",
    forecast: Boolean((match.is_preview || match.schedule_forecast) && !done),
    station: stationText(match),
    done,
    cancelled: isCancelled(match),
    heat: slots.length > 2,
    slots: (slots.length ? slots : [{}, {}]).map((slot) => {
      const info = describeSlot(slot, nameOf, findMatch);
      const pending = info.kind === "pending" ? (treeSlotLabel(slot, findMatch) || info.label) : "";
      return {
        label: info.kind === "player" ? info.label : pending || info.label,
        kind: info.kind,
        score: done && slot.registration_id ? scoreOf(match, slot.registration_id) : "",
        winner: Boolean(winnerId && slot.registration_id === winnerId),
      };
    }),
  };
}

/** Eine Runde, die der Umbau ganz gestrichen hat, fällt weg - wie im Web-Baum. */
function droppedRound(list) {
  return list.length > 0 && list.every((match) => isCancelled(match) && match.result_meta?.source === "heat_rebuild");
}

/**
 * Die Abschnitte des Baums als Blöcke: je Phase und Abschnitt (Winner, Loser, Grand Final, Gruppe A …) die Runden als
 * Spalten mit Rundennamen wie im Web-Baum. Läufe (FFA) sind Karten mit mehr Plätzen, Gruppen Runden je Gruppe.
 */
export function bracketBlocks(bracket) {
  const matches = displayRoundLabels(bracket?.matches_v2 || []);
  const stages = [...(bracket?.stages || [])].sort((a, b) => Number(a?.number || 0) - Number(b?.number || 0));
  const regMap = new Map((bracket?.registrations || []).map((reg) => [reg.id, reg]));
  const finder = finderFor(matches);
  const stageIndex = new Map(stages.map((stage, index) => [stage.id, index]));
  const multi = stages.length > 1;
  const groups = new Map();
  for (const match of matches) {
    const stageId = match.stage_id || "__default";
    const section = String(match.section || "MAIN");
    const key = `${stageId}|${section}`;
    if (!groups.has(key)) groups.set(key, { key, stageId, section, rounds: new Map() });
    const round = Number(match.round) || 1;
    const rounds = groups.get(key).rounds;
    if (!rounds.has(round)) rounds.set(round, []);
    rounds.get(round).push(match);
  }
  const blocks = [];
  for (const group of groups.values()) {
    const numbers = [...group.rounds.keys()].sort((a, b) => a - b);
    const sectionTitle = formatBracketSection(group.section);
    const stage = stages.find((item) => item.id === group.stageId);
    const columns = numbers
      .map((number) => group.rounds.get(number).sort((a, b) => Number(a.order || 0) - Number(b.order || 0)))
      .filter((list) => !droppedRound(list))
      .map((list) => {
        const title = roundName(list[0], Number(list[0].round) || 1);
        return { title: title.toLowerCase() === sectionTitle.toLowerCase() ? "" : title, matches: list.map((match) => printMatch(match, regMap, finder(match))) };
      });
    if (!columns.length) continue;
    blocks.push({
      key: group.key,
      kind: sectionKind(group.section),
      stageOrder: stageIndex.has(group.stageId) ? stageIndex.get(group.stageId) : 0,
      title: multi && stage?.name ? `${stage.name} · ${sectionTitle}` : sectionTitle,
      columns,
    });
  }
  return blocks.sort((a, b) => a.stageOrder - b.stageOrder || SECTION_ORDER[a.kind] - SECTION_ORDER[b.kind] || a.title.localeCompare(b.title, "de", { numeric: true }));
}

/**
 * Teilt Spalten in Bänder (übereinander liegende Seiten), damit jede Spalte in die Höhe passt. Jede Spalte gibt ihren
 * Anteil ab: Band b bekommt die Karten [b·n/B, (b+1)·n/B) - so bleibt der Baum lesbar (obere Hälfte, untere Hälfte).
 * Eine einzelne Karte, die allein zu hoch ist, wird nicht geteilt (`overflow`).
 */
/** Wie viele Plätze eine Karte höchstens haben darf, damit sie allein in eine Spalte passt. */
export function slotsPerCard(capacity) {
  return Math.max(1, Math.floor((capacity - TREE.cardHead - TREE.cardPad) / TREE.cardRow));
}

/**
 * Ein Lauf mit mehr Plätzen, als eine Spalte hoch ist (z. B. 64 in einem Lauf), wird in Teilkarten geteilt - die
 * Plätze gehen auf der nächsten Karte weiter („Teil 2/3“). Nie still abschneiden.
 */
export function splitTallCards(columns, capacity) {
  const most = slotsPerCard(capacity);
  return columns.map((column) => ({
    ...column,
    matches: column.matches.flatMap((match) => {
      if (match.slots.length <= most) return [match];
      const count = Math.ceil(match.slots.length / most);
      const size = Math.ceil(match.slots.length / count);
      return Array.from({ length: count }, (_, index) => ({
        ...match,
        id: `${match.id}#${index + 1}`,
        piece: { index: index + 1, of: count, from: index * size + 1 },
        slots: match.slots.slice(index * size, (index + 1) * size),
      }));
    }),
  }));
}

export function splitBands(columns, capacity) {
  const most = Math.max(1, ...columns.map((column) => column.matches.length));
  const slice = (bands) => Array.from({ length: bands }, (_, band) => columns.map((column) => {
    const n = column.matches.length;
    // Aufgerundet: eine Spalte mit wenigen Spielen (Finale) steht schon auf der ersten Seite, nicht erst auf der letzten.
    return { ...column, matches: column.matches.slice(Math.ceil((band * n) / bands), Math.ceil(((band + 1) * n) / bands)) };
  }));
  for (let bands = 1; bands <= most; bands += 1) {
    const sliced = slice(bands);
    if (sliced.every((band) => band.every((column) => columnHeight(column.matches) <= capacity))) return { bands: sliced, overflow: false };
  }
  return { bands: slice(most), overflow: true };
}

/**
 * Die Seiten des Baums: Spalten in Gruppen zu so vielen, wie nebeneinander passen; jede Gruppe in Bänder, bis alles in
 * die Höhe passt. Jede Seite trägt die Rundennamen ihrer Spalten (wiederholt, mit „Fortsetzung“). Kleine Abschnitte
 * (Grand Final, Spiel um Platz 3) rücken neben den vorigen, wenn Platz ist.
 */
export function bracketPages(bracket, { orientation = PRINT_DEFAULTS.treeOrientation } = {}) {
  const maxColumns = treeColumns(orientation);
  const capacity = treeColumnCapacity(orientation);
  const pages = [];
  for (const block of bracketBlocks(bracket)) {
    const chunks = [];
    for (let start = 0; start < block.columns.length; start += maxColumns) chunks.push(block.columns.slice(start, start + maxColumns));
    const parts = [];
    for (const chunk of chunks) {
      const { bands, overflow } = splitBands(splitTallCards(chunk, capacity), capacity);
      // Je Spalte: auf wie vielen Seiten sie Spiele hat. Nur dort steht ihr Kopf - mit „1/2“, „2/2“ nur, wenn es mehrere
      // sind. Eine Seite zeigt keine leere Spalte.
      const spread = chunk.map((_, index) => bands.filter((band) => band[index].matches.length).length);
      const seen = chunk.map(() => 0);
      bands.forEach((band) => {
        const columns = band.flatMap((column, index) => {
          if (!column.matches.length) return [];
          seen[index] += 1;
          return [{ ...column, continued: spread[index] > 1 ? { band: seen[index], of: spread[index] } : null }];
        });
        if (columns.length) parts.push({ columns, overflow });
      });
    }
    parts.forEach((part, index) => {
      const piece = { key: `${block.key}#${index}`, title: block.title, kind: block.kind, part: parts.length > 1 ? { index: index + 1, of: parts.length } : null, columns: part.columns, overflow: part.overflow };
      const last = pages[pages.length - 1];
      const used = last ? last.blocks.reduce((sum, item) => sum + item.columns.length, 0) : 0;
      const fitsBeside = last && parts.length === 1 && last.blocks.every((item) => !item.part || item.part.index === item.part.of)
        && used + piece.columns.length <= maxColumns;
      if (fitsBeside) last.blocks.push(piece);
      else pages.push({ kind: "baum", orientation, blocks: [piece] });
    });
  }
  return pages;
}

// --------------------------------------------------------------------------------------------------- Listen allgemein

/**
 * Verteilt Abschnitte mit Zeilen auf Seiten. Jede Seite beginnt mit dem Tabellenkopf (`tableHead`); ein Abschnitt
 * beginnt nur, wenn sein Kopf und mindestens eine Zeile noch Platz haben, und geht auf der nächsten Seite mit
 * „Fortsetzung“ weiter. `rowHeight(row)` sagt die Höhe einer Zeile.
 */
export function paginate(sections, { capacity, tableHead = 0, sectionHead = 0, rowHeight = () => 8 }) {
  const pages = [];
  let page = null;
  let left = 0;
  const open = () => {
    page = { sections: [] };
    pages.push(page);
    left = capacity - tableHead;
  };
  for (const section of sections) {
    const rows = section.rows || [];
    let current = null;
    let seen = false;
    for (const row of rows) {
      const height = rowHeight(row);
      if (!page || left < (current ? height : sectionHead + height)) {
        open();
        current = null;
      }
      if (!current) {
        current = { key: section.key, title: section.title, note: section.note || "", continued: seen, rows: [] };
        page.sections.push(current);
        left -= sectionHead;
        seen = true;
      }
      current.rows.push(row);
      left -= height;
    }
    if (!rows.length && section.keepEmpty) {
      const height = sectionHead + rowHeight(null);
      if (!page || left < height) open();
      page.sections.push({ key: section.key, title: section.title, note: section.note || "", continued: false, rows: [], empty: true });
      left -= height;
    }
  }
  return pages;
}

export function listCapacity(orientation = PRINT_DEFAULTS.listOrientation) {
  return sheetBody(orientation).height;
}

// -------------------------------------------------------------------------------------------------------- Spielplan

export const SCHEDULE = { tableHead: 8, sectionHead: 9, linePerSide: 5, rowPad: 2, minRow: 8 };

export function scheduleRowHeight(row) {
  if (!row) return SCHEDULE.minRow;
  const lines = row.heat ? row.sides.length : 1;
  return Math.max(SCHEDULE.minRow, SCHEDULE.rowPad + lines * SCHEDULE.linePerSide);
}

function scheduleRow(entry) {
  const sides = entry.sides.map((side) => ({ label: side.label, known: side.known, score: side.score == null ? "" : String(side.score), winner: side.winner }));
  return {
    id: entry.id,
    time: entry.scheduledAt ? viennaTime(entry.scheduledAt, { hour: "2-digit", minute: "2-digit" }) : "",
    forecast: entry.forecast,
    station: entry.stationLabel,
    round: entry.roundLabel,
    group: entry.groupLabel,
    key: String(entry.match?.match_key || ""),
    heat: sides.length > 2,
    sides,
    done: entry.tone === "done",
    cancelled: entry.tone === "cancelled",
  };
}

/** Der Spielplan als Abschnitte: nach Zeit (je Tag) oder je Station; Rundennamen wie im Baum. */
export function scheduleSections(bracket, { order = PRINT_DEFAULTS.scheduleOrder } = {}) {
  const named = { ...(bracket || {}), matches_v2: displayRoundLabels(bracket?.matches_v2 || []) };
  const entries = scheduleEntries(named).filter((entry) => entry.tone !== "cancelled");
  if (order === "station") {
    return groupByStation(entries).map((group) => ({ key: `s-${group.key}`, title: group.label, rows: group.entries.map(scheduleRow) }));
  }
  const timed = [...entries].sort((a, b) => {
    if (a.scheduledAt && b.scheduledAt && a.scheduledAt !== b.scheduledAt) return a.scheduledAt < b.scheduledAt ? -1 : 1;
    if (!a.scheduledAt !== !b.scheduledAt) return a.scheduledAt ? -1 : 1;
    return a.round - b.round || a.order - b.order;
  });
  const sections = new Map();
  for (const entry of timed) {
    const key = entry.scheduledAt ? viennaDate(entry.scheduledAt, { weekday: "long", day: "numeric", month: "long" }) : "Ohne Termin";
    if (!sections.has(key)) sections.set(key, { key: `d-${key}`, title: key, rows: [] });
    sections.get(key).rows.push(scheduleRow(entry));
  }
  return [...sections.values()];
}

/** Ein Lauf mit mehr Plätzen, als auf eine Seite passen, geht in Teilzeilen weiter („Teil 2/2“) - nie abgeschnitten. */
export function splitTallRows(rows, capacity) {
  const most = Math.max(1, Math.floor((capacity - SCHEDULE.tableHead - SCHEDULE.sectionHead - SCHEDULE.rowPad) / SCHEDULE.linePerSide));
  return rows.flatMap((row) => {
    if (!row.heat || row.sides.length <= most) return [row];
    const count = Math.ceil(row.sides.length / most);
    const size = Math.ceil(row.sides.length / count);
    return Array.from({ length: count }, (_, index) => ({
      ...row, id: `${row.id}#${index + 1}`, piece: { index: index + 1, of: count }, sides: row.sides.slice(index * size, (index + 1) * size),
    }));
  });
}

export function schedulePages(bracket, { orientation = PRINT_DEFAULTS.listOrientation, order = PRINT_DEFAULTS.scheduleOrder } = {}) {
  const capacity = listCapacity(orientation);
  const sections = scheduleSections(bracket, { order }).map((section) => ({ ...section, rows: splitTallRows(section.rows, capacity) }));
  return paginate(sections, {
    capacity: listCapacity(orientation), tableHead: SCHEDULE.tableHead, sectionHead: SCHEDULE.sectionHead, rowHeight: scheduleRowHeight,
  }).map((page) => ({ ...page, kind: "spielplan", orientation }));
}

// ------------------------------------------------------------------------------------------------- Check-in-Liste

export const CHECKIN = { tableHead: 8, sectionHead: 9, row: 8 };

/** Turnier: Antwort von GET /api/tournaments/:id/print/checkin. */
export function tournamentCheckinSections(list) {
  const row = (item, index) => ({
    id: item.id, number: index + 1, name: item.name, detail: [item.ingame_name, item.team_tag ? `[${item.team_tag}]` : "", item.member_count ? `${item.member_count} Spieler` : ""].filter(Boolean).join(" · "),
    seed: item.seed ? String(item.seed) : "", checked: Boolean(item.checked_in), extra: "",
  });
  return [
    { key: "erwartet", title: "Erwartet", note: `${list?.counts?.checked_in || 0} von ${list?.counts?.expected || 0} schon da`, rows: (list?.expected || []).map(row), keepEmpty: true },
    ...((list?.waitlist || []).length ? [{ key: "warteliste", title: "Warteliste", note: "in Reihenfolge der Anmeldung", rows: list.waitlist.map(row) }] : []),
  ];
}

/** Event: Antwort von GET /api/events/:slug/lead?filter=all - mit Begleitpersonen. */
export function eventCheckinSections(lead) {
  const rows = lead?.registrations || [];
  const companions = (item) => {
    const count = Number(item.companion_count) || 0;
    return count ? `+${count} Begleitung` : "";
  };
  const row = (item, index) => ({ id: item.id, number: index + 1, name: item.display_name || "Teilnehmer", detail: "", seed: "", checked: item.status === "checked_in", extra: companions(item) });
  const expected = rows.filter((item) => item.status === "registered" || item.status === "checked_in");
  const waitlist = rows.filter((item) => item.status === "waitlist");
  const here = expected.filter((item) => item.status === "checked_in").length;
  return [
    { key: "erwartet", title: "Erwartet", note: `${here} von ${expected.length} schon da`, rows: expected.map(row), keepEmpty: true },
    ...(waitlist.length ? [{ key: "warteliste", title: "Warteliste", note: "in Reihenfolge der Anmeldung", rows: waitlist.map(row) }] : []),
  ];
}

export function checkinPages(sections, { orientation = PRINT_DEFAULTS.listOrientation } = {}) {
  return paginate(sections, { capacity: listCapacity(orientation), tableHead: CHECKIN.tableHead, sectionHead: CHECKIN.sectionHead, rowHeight: () => CHECKIN.row })
    .map((page) => ({ ...page, kind: "liste", orientation }));
}

// ------------------------------------------------------------------------------------------------------ Tagesplan

export const DAYPLAN = { tableHead: 8, sectionHead: 9, row: 9 };

function clock(time) {
  return viennaTime(time, { hour: "2-digit", minute: "2-digit" });
}

/** Der Tagesplan je Tag: Einlass, Turniere und Fast Laps mit Zeit und Check-in - aus der Event-Antwort. */
export function dayPlanSections(event) {
  const items = planItems(event);
  const days = eventDays(event, items);
  return days.map((day) => {
    const own = items.filter((item) => (days.length > 1 ? dayIndexOf(days, item.from) === day.index : true));
    const rows = [];
    if (day.doorAt !== null && day.doorAt !== undefined) rows.push({ id: `door-${day.index}`, from: day.doorAt, time: clock(day.doorAt), title: "Einlass", kind: "", note: "" });
    for (const item of own) {
      const source = item.source || {};
      const checkIn = source.check_in_from ? `Check-in ab ${clock(source.check_in_from)}` : "";
      rows.push({
        id: item.id,
        from: item.from,
        time: item.to ? `${clock(item.from)}–${clock(item.to)}` : `ab ${clock(item.from)}`,
        title: item.title,
        kind: item.kind === "fastlap" ? "Fast Lap" : "Turnier",
        note: checkIn,
      });
    }
    rows.sort((a, b) => a.from - b.from);
    const weekday = viennaDate(day.startAt, { weekday: "long", day: "numeric", month: "long" });
    return {
      key: `tag-${day.index}`,
      title: days.length > 1 ? `Tag ${day.index + 1} von ${days.length} · ${weekday}` : weekday,
      note: `${clock(day.startAt)}–${clock(day.endAt)}`,
      rows,
      keepEmpty: true,
    };
  });
}

export function dayPlanPages(event, { orientation = PRINT_DEFAULTS.listOrientation } = {}) {
  return paginate(dayPlanSections(event), { capacity: listCapacity(orientation), tableHead: DAYPLAN.tableHead, sectionHead: DAYPLAN.sectionHead, rowHeight: () => DAYPLAN.row })
    .map((page) => ({ ...page, kind: "tagesplan", orientation }));
}
