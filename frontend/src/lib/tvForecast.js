// „Als Nächstes“ mit Prognose am TV (#1564): wann ein Spiel ungefähr losgeht und wo. Die Zeit kommt aus dem Planer
// (services/match_scheduler, #1569: `scheduled_at`, `schedule_forecast` = die Plätze stehen noch nicht fest). Der
// Verzug kommt aus der Halle: Ein Spiel beginnt frühestens, wenn seine Station frei ist - läuft dort gerade ein Spiel,
// ist das seine Startzeit plus geplanter Dauer, und überzieht es, „jetzt“. Ist die geplante Zeit schon vorbei und das
// Spiel noch nicht gestartet, beginnt es frühestens jetzt. Alles reine Rechnung - die Uhr gibt der Aufrufer.
import { bracketEdges } from "@/lib/bracketGraph";
import { effectiveMatchDuration } from "@/lib/matchDuration";
import { isMatchDone } from "@/lib/slotSource";
import { isLiveMatch, stationName } from "@/lib/tvLive";
import { asInstant, viennaTime } from "@/lib/vienna";

const MINUTE = 60000;
// Ab so viel Verschiebung sagt der TV „Verzug“ - darunter ist es Rauschen.
export const DELAY_SHOWN_FROM = 5;
// Mehr als drei Stunden hinter dem Plan ist kein Verzug mehr, sondern ein alter Plan: dann nur die Station.
export const STALE_AFTER = 180;
const OPEN = new Set(["pending", "preview", "ready", "scheduled"]);

function timeOf(value) {
  if (!value) return null;
  const time = asInstant(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function minutesOf(match) {
  // Die Dauer aus einer Stelle (lib/matchDuration, #1554) - am TV rechnet sie der Server schon aus.
  return Number(match?.effective_duration_minutes) || effectiveMatchDuration(match);
}

/** Die Station im Klartext: aus dem Spiel, sonst aus der Liste der Stationen. */
function stationOf(match, stations) {
  const own = stationName(match);
  if (own) return own;
  const station = (stations || []).find((row) => row?.id && row.id === match?.station_id);
  const raw = String(station?.name || station?.label || "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? `Station ${raw}` : raw;
}

/** Ein kleiner Min-Heap (Codex-Nachprüfung #1564): das nächste bereite Spiel in O(log n) statt jedes Mal sortieren. */
function minHeap(before) {
  const items = [];
  const swap = (a, b) => { [items[a], items[b]] = [items[b], items[a]]; };
  return {
    get size() { return items.length; },
    push(item) {
      items.push(item);
      let index = items.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (before(items[parent], items[index]) <= 0) break;
        swap(parent, index);
        index = parent;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let index = 0;
        for (;;) {
          const left = index * 2 + 1;
          const right = left + 1;
          let smallest = index;
          if (left < items.length && before(items[left], items[smallest]) < 0) smallest = left;
          if (right < items.length && before(items[right], items[smallest]) < 0) smallest = right;
          if (smallest === index) break;
          swap(index, smallest);
          index = smallest;
        }
      }
      return top;
    },
  };
}

/**
 * In welcher Reihenfolge die offenen Spiele gerechnet werden: nach den Linien (ein Spiel erst nach seinen offenen
 * Vorspielen), unter den bereiten das nach Plan früheste (Zeit, Runde, Reihenfolge, dann Lage in der Liste). Spiele in
 * einem Kreis der Linien fehlen. Liefert `{ order: [Spiel], open, before }`.
 */
function planOrder(list) {
  const before = new Map();
  for (const edge of bracketEdges(list)) {
    if (edge.void) continue;
    if (!before.has(edge.to)) before.set(edge.to, new Set());
    before.get(edge.to).add(edge.from);
  }
  const open = list.filter(isOpen);
  const position = new Map(list.map((match, index) => [match.id, index]));
  const openIds = new Set(open.map((match) => match.id));
  const waitingOn = new Map(open.map((match) => [match.id, new Set([...(before.get(match.id) || [])].filter((id) => openIds.has(id)))]));
  const after = new Map();
  for (const [id, preds] of waitingOn) for (const pred of preds) after.set(pred, [...(after.get(pred) || []), id]);
  const byPlan = (a, b) => (timeOf(a.scheduled_at) ?? Number.MAX_SAFE_INTEGER) - (timeOf(b.scheduled_at) ?? Number.MAX_SAFE_INTEGER)
    || (a.round || 0) - (b.round || 0) || (a.order || 0) - (b.order || 0) || position.get(a.id) - position.get(b.id);
  const ready = minHeap(byPlan);
  for (const match of open) if (!waitingOn.get(match.id).size) ready.push(match);
  const openById = new Map(open.map((match) => [match.id, match]));
  const order = [];
  while (ready.size) {
    const match = ready.pop();
    order.push(match);
    for (const next of after.get(match.id) || []) {
      const preds = waitingOn.get(next);
      preds.delete(match.id);
      if (!preds.size) ready.push(openById.get(next));
    }
  }
  return { order, open, before };
}

/** Die Reihenfolge der Rechnung als Kennungen - für Prüfungen. */
export function forecastOrder(matches = []) {
  return planOrder((matches || []).filter((match) => match?.id)).order.map((match) => match.id);
}

/** Eine Prognose aus geplanter und voraussichtlicher Zeit - mit Verzug in Worten; ein alter Plan ist kein Verzug. */
function entryOf(match, at, eta, stations) {
  const late = at === null || eta === null ? 0 : Math.max(0, Math.round((eta - at) / MINUTE));
  const stale = late > STALE_AFTER;
  const delayMinutes = stale ? 0 : late;
  return {
    match,
    at,
    eta: stale ? null : eta,
    stale,
    delayMinutes,
    forecast: Boolean(match?.schedule_forecast),
    station: stationOf(match, stations),
    delayText: delayMinutes >= DELAY_SHOWN_FROM ? `${delayMinutes} Min. Verzug` : "",
  };
}

/**
 * Die Prognose für alle offenen Spiele auf einmal (#1564) - eine Rechnung für Karte, Fuß, Aufruf-Tafel und Halle, damit
 * am Beamer überall dieselbe Zeit steht. Ein Spiel beginnt frühestens, wenn
 *   - seine geplante Zeit da ist (`scheduled_at` vom Planer),
 *   - seine Station frei ist (laufendes Spiel: Start plus Dauer, überzogen: jetzt; davor geplante Spiele an derselben
 *     Station: deren Prognose plus Dauer) und
 *   - seine Vorspiele fertig sind (die Linien aus lib/bracketGraph) -
 * und nie vor „jetzt“. So rückt ein Verzug die Folgespiele nach. Erst ab einer Minute zählt das: Sekunden zwischen
 * Planer und Start sind kein Verzug. Liefert eine Map Spiel-Kennung → Prognose.
 */
export function forecastBoard(matches = [], { stations = [], now = Date.now() } = {}) {
  const list = (matches || []).filter((match) => match?.id);
  const { order, open, before } = planOrder(list);
  const ends = new Map();
  const free = new Map();
  const block = (stationId, end) => {
    if (stationId) free.set(stationId, Math.max(free.get(stationId) ?? end, end));
  };
  for (const match of list) {
    if (!isLiveMatch(match)) continue;
    const start = timeOf(match.started_at) ?? timeOf(match.scheduled_at) ?? now;
    const end = Math.max(now, start + minutesOf(match) * MINUTE);
    ends.set(match.id, end);
    block(match.station_id, end);
  }
  // Reihenfolge aus den Linien (planOrder): ein Spiel erst nach seinen Vorspielen; ein Kreis bekommt keine Uhrzeit.
  // Abhängig ist ein Spiel nur über seine Linien - nicht über „alle Spiele der Runde“.
  const board = new Map();
  for (const match of order) {
    const at = timeOf(match.scheduled_at);
    let eta = at;
    if (eta !== null) {
      const waits = [free.get(match.station_id), ...[...(before.get(match.id) || [])].map((id) => ends.get(id))].filter((value) => value !== undefined);
      const earliest = waits.length ? Math.max(...waits) : null;
      if (earliest !== null && earliest - eta >= MINUTE) eta = earliest;
      if (eta < now) eta = now;
    }
    board.set(match.id, entryOf(match, at, eta, stations));
    // Auch ein alter Plan (nur in der Anzeige ausgeblendet) belegt seine Station und hält seine Folgespiele auf.
    if (eta !== null) {
      const end = eta + minutesOf(match) * MINUTE;
      ends.set(match.id, end);
      block(match.station_id, end);
    }
  }
  // Was übrig bleibt, hängt in einem Kreis (oder an einem): keine Prognose.
  for (const match of open) if (!board.has(match.id)) board.set(match.id, { ...entryOf(match, timeOf(match.scheduled_at), null, stations), cycle: true });
  return board;
}

/**
 * Die Prognose eines offenen Spiels: `at` geplant, `eta` voraussichtlich, `delayMinutes`, `forecast` (Zeit des Planers
 * für noch offene Plätze), `station` und `delayText` („12 Min. Verzug“, unter DELAY_SHOWN_FROM leer). Aus derselben
 * Rechnung wie alle anderen (forecastBoard).
 */
export function forecastOf(match, { matches = [], stations = [], now = Date.now() } = {}) {
  const list = (matches || []).some((row) => row?.id === match?.id) ? matches : [...(matches || []), match];
  return forecastBoard(list, { stations, now }).get(match?.id) || entryOf(match, timeOf(match?.scheduled_at), null, stations);
}

/** „ca. 16:40 · Switch 2“ - ohne Uhrzeit nur die Station. Planung ist nie auf die Minute genau, deshalb immer „ca.“. */
export function forecastText(entry) {
  if (!entry) return "";
  const time = entry.eta === null || entry.eta === undefined ? "" : `ca. ${viennaTime(entry.eta, { hour: "2-digit", minute: "2-digit" })}`;
  return [time, entry.station].filter(Boolean).join(" · ");
}

function isOpen(match) {
  const status = String(match?.status || "pending").toLowerCase();
  return Boolean(match?.id) && OPEN.has(status) && !isMatchDone(match) && !isLiveMatch(match);
}

/**
 * Die nächsten offenen Spiele mit Uhrzeit oder Station, nach ihrer Prognose (dann geplanter Zeit, Runde, Reihenfolge).
 * `exclude`: Spiele, die schon anders stehen (z. B. aufgerufen).
 */
export function nextUp(matches = [], { stations = [], now = Date.now(), limit = 3, exclude = null, board: given = null } = {}) {
  // Mit `board` aus derselben Rechnung wie die Karten - so steht am Beamer überall dieselbe Zeit.
  const board = given || forecastBoard(matches, { stations, now });
  return (matches || [])
    .filter((match) => isOpen(match) && (match.scheduled_at || match.station_id) && !(exclude && exclude.has(match.id)))
    .map((match) => board.get(match.id))
    .filter(Boolean)
    .sort((a, b) => (a.eta ?? Number.MAX_SAFE_INTEGER) - (b.eta ?? Number.MAX_SAFE_INTEGER)
      || (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER)
      || (a.match.round || 0) - (b.match.round || 0)
      || (a.match.order || 0) - (b.match.order || 0))
    .slice(0, limit);
}
