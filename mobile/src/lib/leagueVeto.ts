import { serverOffset } from "../seasons/newYear/countdown";

// Map-Veto auf der Matchseite (#2173, Web: frontend/src/lib/leagueVeto.js „Matchseite“ und „Live“, docs/LIGA.md D.3/D.4): Sätze,
// Takt des kurzen Abrufs, Countdown nach der Serverzeit, Ablauf und Brett. Der Server bleibt maßgeblich - gewählt wird nur dort.
// Dieselben Sätze und Regeln wie im Web; lib/leagueVeto.test.ts prüft dieselben Fälle.

export type VetoKind = "ban" | "pick" | "decider" | "preset";
export type VetoStatus = "waiting" | "running" | "paused" | "done" | "skipped";

export type VetoCurrent = {
  index?: number;
  number?: number;
  total?: number;
  kind?: VetoKind | string;
  mode?: string;
  mode_label?: string;
  mode_icon_url?: string | null;
  registration_id?: string | null;
  name?: string | null;
  position?: number | null;
  deadline_at?: string | null;
  remaining_seconds?: number | null;
};

export type VetoMap = {
  map_id: string;
  name?: string;
  image_url?: string | null;
  status?: "open" | "banned" | "picked" | "decider" | "preset" | "elsewhere" | string;
  by_name?: string | null;
  position?: number | null;
  side?: "A" | "B" | null;
};

export type VetoGroup = { mode: string; label?: string; icon_url?: string | null; maps?: VetoMap[] };
export type VetoOption = { map_id: string; name?: string; image_url?: string | null; allowed?: boolean; hint?: string | null };
export type VetoHistoryRow = { index: number; kind?: string; mode_label?: string; name?: string | null; map_name?: string; position?: number | null; via?: string; at?: string };
export type PlannedGame = { position: number; mode?: string; mode_label?: string; map_id?: string; map_name?: string; map_image_url?: string | null; role?: string };
export type VetoPreset = { mode: string; mode_label?: string; position?: number; map_id?: string; map_name?: string; map_image_url?: string | null };
export type VetoPlanRow = {
  index: number; number?: number; kind?: string; mode?: string; mode_label?: string; side?: "A" | "B" | null; name?: string | null;
  position?: number | null; state?: "done" | "current" | "open"; map_id?: string | null; map_name?: string | null; via?: string | null;
};
export type VetoStartSide = { registration_id: string; name?: string; ready?: boolean; own?: boolean };
export type VetoStart = {
  sides?: VetoStartSide[];
  own_ready?: boolean;
  other_ready?: boolean;
  can_ready?: boolean;
  can_withdraw?: boolean;
  hint?: string | null;
  lead?: { can_start?: boolean } | null;
};

export type VetoBlock = {
  status?: VetoStatus | string;
  skipped_reason?: string | null;
  version?: number;
  step_seconds?: number;
  team_a?: { registration_id?: string; name?: string; via?: string } | null;
  team_b?: { registration_id?: string; name?: string } | null;
  current?: VetoCurrent | null;
  own_turn?: boolean;
  can_pick?: boolean;
  pick_hint?: string | null;
  options?: VetoOption[];
  remaining?: VetoGroup[];
  history?: VetoHistoryRow[];
  planned_games?: PlannedGame[];
  paused?: { at?: string; reason?: string | null; remaining_seconds?: number } | null;
  lead?: { can_act?: boolean } | null;
  week?: number | null;
  presets?: VetoPreset[];
  blocked?: { week?: number; text?: string } | null;
  start?: VetoStart | null;
  plan?: VetoPlanRow[];
  own_side?: "A" | "B" | null;
  server_now?: string | null;
};

export const VETO_STATUS_LABELS: Record<string, string> = {
  waiting: "Veto wartet",
  running: "Veto läuft",
  paused: "Veto pausiert",
  done: "Spielreihenfolge steht",
  skipped: "Kein Veto in diesem Spiel",
};

/** Die Überschrift: die fehlende Vorgabe geht vor, danach „bereit zum Veto?“, sonst der Status. */
export function vetoHeadline(block?: VetoBlock | null): string {
  if (block?.status === "waiting" && block.blocked) return "Veto wartet auf die Vorgabe der Woche";
  if (block?.status === "waiting" && block.start) return block.presets?.length ? "Vorgabe steht – bereit zum Veto?" : "Bereit zum Veto?";
  if (block?.status === "waiting") return "Vorgabe der Woche";
  return VETO_STATUS_LABELS[String(block?.status)] || "Veto";
}

/** Die Rolle einer Map in der Spielreihenfolge als Zusatz hinter „Map 3“: Decider, Vorgabe der Woche - sonst nichts. */
export function plannedRoleLabel(role?: string | null): string {
  if (role === "decider") return "Decider";
  if (role === "preset") return "Vorgabe der Woche";
  return "";
}

/** Der Satz im Stand „bereit zum Veto?“: wer schon bereit ist und was die eigene Seite jetzt tut. */
export function readyText(start?: VetoStart | null): string {
  const sides = start?.sides || [];
  const other = sides.find((side) => !side.own)?.name || "die Gegenseite";
  if (sides.length > 1 && sides.every((side) => side.ready)) return "Beide Seiten sind bereit – das Veto beginnt gleich.";
  if (start?.own_ready) return "Ihr seid bereit – wartet auf die Gegenseite.";
  if (start?.can_ready && start.other_ready) return `${other} ist bereit – tippt auf „Bereit zum Veto“, dann beginnt es sofort.`;
  if (start?.can_ready) return "Tippt auf „Bereit zum Veto“, sobald ihr so weit seid. Das Veto beginnt, wenn beide Seiten bereit sind.";
  const ready = sides.filter((side) => side.ready).map((side) => side.name);
  return ready.length ? `${ready.join(" und ")} ist bereit. Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben.`
    : "Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben.";
}

/** Der eine Satz unter der Überschrift des Veto-Blocks. */
export function vetoText(block?: VetoBlock | null): string {
  if (!block) return "";
  const current = block.current;
  const name = current?.name || "die Gegenseite";
  switch (block.status) {
    case "waiting":
      if (block.blocked?.text) return block.blocked.text;
      if (block.start) return readyText(block.start);
      return "Sobald beide Seiten eingecheckt sind, beginnt das Map-Veto – danach startet Map 1.";
    case "running":
      if (!current) return "Das Veto läuft.";
      if (current.kind === "decider") return `Die übrige Map wird Map ${current.position} – das setzt das System.`;
      if (current.kind === "preset") return `Die Vorgabe der Woche wird Map ${current.position} – das setzt das System.`;
      if (block.own_turn) return `Ihr seid am Zug: ${current.kind === "ban" ? "sperrt eine Map" : `wählt Map ${current.position}`} (${current.mode_label}). Nach ${block.step_seconds} Sekunden wählt das System.`;
      return `${name} ist am Zug: ${current.kind === "ban" ? "sperrt eine Map" : `wählt Map ${current.position}`} (${current.mode_label}).`;
    case "paused":
      return `Die Liga-Leitung hat das Veto angehalten${block.paused?.reason ? ` – ${block.paused.reason}` : ""}. Es geht weiter, sobald sie es fortsetzt.`;
    case "done":
      return "Die Spielreihenfolge steht – Map 1 kann beginnen.";
    case "skipped":
      return block.skipped_reason ? `In diesem Spiel läuft kein Veto: ${block.skipped_reason} Die Maps werden beim Ergebnis eingetragen.` : "In diesem Spiel läuft kein Veto.";
    default:
      return "";
  }
}

/** „Schritt 3 von 11 · Stellung · Team A wählt Map 1“ */
export function stepLabel(current?: VetoCurrent | null): string {
  if (!current) return "";
  const what = current.kind === "ban" ? "sperrt eine Map" : current.kind === "pick" ? `wählt Map ${current.position}`
    : current.kind === "preset" ? `Vorgabe der Woche für Map ${current.position}` : `Decider für Map ${current.position}`;
  return `Schritt ${current.number} von ${current.total} · ${current.mode_label} · ${current.name ? `${current.name} ${what}` : what}`;
}

/** Das Wort je Map: „Sperren“ oder „Wählen“. */
export function actionWord(kind?: string | null): string {
  return kind === "ban" ? "Sperren" : "Wählen";
}

/** Die Frage an die Seite am Zug - über dem Brett. */
export function ownTurnQuestion(current?: VetoCurrent | null): string {
  if (!current) return "";
  return current.kind === "ban" ? `Welche Map sperrt ihr (${current.mode_label})?` : `Welche Map spielt ihr als Map ${current.position} (${current.mode_label})?`;
}

/** Die Zeile einer Map in der Übersicht je Modus: „gesperrt von Loewen“, „Map 1 · Loewen“, „Map 3 · Decider“, „offen“. */
export function mapStatusText(row?: Pick<VetoMap, "status" | "by_name" | "position"> | null): string {
  if (!row) return "";
  if (row.status === "banned") return row.by_name ? `gesperrt von ${row.by_name}` : "gesperrt";
  if (row.status === "picked") return `Map ${row.position}${row.by_name ? ` · ${row.by_name}` : ""}`;
  if (row.status === "decider") return `Map ${row.position} · Decider`;
  if (row.status === "preset") return `Map ${row.position} · Vorgabe der Woche`;
  if (row.status === "elsewhere") return `in anderem Modus gespielt${row.position ? ` (Map ${row.position})` : ""}`;
  return "offen";
}

/** Eine Zeile im Verlauf: „1. Loewen sperrt Glut (Stellung)“, „11. Decider: Hafen → Map 3 (Kontrolle)“. */
export function historyLine(row?: VetoHistoryRow | null): string {
  if (!row) return "";
  const auto = row.via === "auto" && row.kind !== "decider" ? " · Zeit abgelaufen, das System hat gewählt" : "";
  if (row.kind === "decider") return `${row.index + 1}. Decider: ${row.map_name} → Map ${row.position} (${row.mode_label})`;
  if (row.kind === "preset") return `${row.index + 1}. Vorgabe der Woche: ${row.map_name} → Map ${row.position} (${row.mode_label})`;
  if (row.kind === "ban") return `${row.index + 1}. ${row.name || "?"} sperrt ${row.map_name} (${row.mode_label})${auto}`;
  return `${row.index + 1}. ${row.name || "?"} wählt ${row.map_name} → Map ${row.position} (${row.mode_label})${auto}`;
}

// ---------------------------------------------------------------- Live (D.4)

/** Takt des kurzen Abrufs (ms): läuft 2 s, Pause 5 s, Warten auf „Bereit“ oder die Vorgabe 3 s - nur mit beiden Seiten eingecheckt. */
export const VETO_POLL_MS = Object.freeze({ running: 2000, paused: 5000, waiting: 3000 });

export function vetoPollMs(block?: VetoBlock | null, { bothIn = false }: { bothIn?: boolean } = {}): number {
  if (!block) return 0;
  if (block.status === "running") return VETO_POLL_MS.running;
  if (block.status === "paused") return VETO_POLL_MS.paused;
  if (block.status === "waiting" && (block.blocked || block.start) && bothIn) return VETO_POLL_MS.waiting;
  return 0;
}

/** Abstand Serveruhr - Geräteuhr (ms) aus `server_now`; ohne gültige Zeit 0. */
export function vetoClockOffset(serverNowIso?: string | null, receivedAt = Date.now(), requestedAt = receivedAt): number {
  return serverOffset(serverNowIso, requestedAt, receivedAt);
}

/** Die Frist des laufenden Schritts in Geräte-Zeit - sonst `null`. */
export function vetoDeadline(block?: VetoBlock | null, offset = 0): number | null {
  if (block?.status !== "running" || !block.current?.deadline_at) return null;
  const at = new Date(block.current.deadline_at).getTime();
  return Number.isFinite(at) ? at - (Number(offset) || 0) : null;
}

/** Wie viel vom Ring noch übrig ist (1 = voll) - über die Zeit je Schritt. */
export function vetoRingShare(block?: VetoBlock | null, now = Date.now(), offset = 0): number {
  const target = vetoDeadline(block, offset);
  const seconds = Number(block?.step_seconds) || 0;
  if (!target || !seconds) return 1;
  return Math.min(1, Math.max(0, (target - now) / (seconds * 1000)));
}

/** Ganze Sekunden bis zur Frist (aufgerundet, nie unter 0) - `null` ohne Frist. */
export function secondsLeft(deadline: number | null | undefined, now = Date.now()): number | null {
  if (deadline == null || !Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export const URGENT_SECONDS = 10;
export const isUrgent = (seconds: number | null | undefined) => seconds != null && seconds <= URGENT_SECONDS;

/** Der Vorleser sagt die Zeit nur bei 30, 10 und 5 Sekunden und beim Ablauf an. */
export const ANNOUNCE_AT = Object.freeze([30, 10, 5]);

export function countdownAnnouncement(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  if (seconds <= 0) return "Zeit abgelaufen – das System wählt.";
  const mark = [...ANNOUNCE_AT].reverse().find((value) => seconds <= value);
  return mark ? `Noch ${mark} Sekunden.` : "";
}

export type SideTone = "a" | "b" | "system";
export const sideTone = (side?: string | null): SideTone => (side === "A" ? "a" : side === "B" ? "b" : "system");

export const KIND_SHORT: Record<string, string> = { ban: "Sperre", pick: "Wahl", decider: "Decider", preset: "Vorgabe" };

export type TimelineRow = VetoPlanRow & { key: string; kindLabel: string; who: string; tone: SideTone; target: string; auto: boolean };

/** Der Ablauf als Zeitleiste: jeder Schritt mit Art, Seite und Modus - fertige mit Map, der laufende als `current`. */
export function timelineRows(block?: Pick<VetoBlock, "plan"> | null): TimelineRow[] {
  return (block?.plan || []).map((row) => ({
    ...row,
    key: `step-${row.index}`,
    kindLabel: KIND_SHORT[String(row.kind)] || String(row.kind || ""),
    who: row.side ? (row.name || `Team ${row.side}`) : row.kind === "preset" ? "Liga-Leitung" : "System",
    tone: sideTone(row.side),
    target: row.kind === "ban" ? "" : row.position ? `Map ${row.position}` : "",
    auto: row.via === "auto" && row.kind !== "decider" && row.kind !== "preset",
  }));
}

/** Der Satz zu einem Schritt für den Vorleser: „Schritt 3 von 11: Loewen wählt Map 1 (Stellung) – Hafen“. */
export function timelineLabel(row: TimelineRow, total: number): string {
  const what = row.kind === "ban" ? "sperrt eine Map" : row.kind === "pick" ? `wählt Map ${row.position}`
    : row.kind === "decider" ? `Decider für Map ${row.position}` : `Vorgabe der Woche für Map ${row.position}`;
  const state = row.state === "done" ? ` – ${row.map_name || "erledigt"}${row.auto ? ", das System hat gewählt" : ""}`
    : row.state === "current" ? " – läuft" : "";
  return `Schritt ${row.number} von ${total}: ${row.side ? `${row.who} ` : ""}${what} (${row.mode_label || row.mode})${state}`;
}

const cardKey = (mode: string, mapId: string) => `${mode}:${mapId}`;

export type BoardCard = VetoMap & { key: string; index: number; option: VetoOption | null; pickable: boolean; selectable: boolean; tone: SideTone; statusText: string };
export type BoardGroup = VetoGroup & { current: boolean; cards: BoardCard[] };

/**
 * Die Karten des Bretts je Modus. `selectable`: die Seite am Zug kann die Karte jetzt antippen; `pickable`: die Karte gehört zur
 * Auswahl des laufenden Schritts (auch ausgegraut, mit Hinweis). `current`: der Modus des laufenden Schritts.
 */
export function boardGroups(block?: VetoBlock | null): BoardGroup[] {
  const current = block?.status === "running" || block?.status === "paused" ? block.current : null;
  const options = new Map((block?.options || []).map((option) => [option.map_id, option]));
  return (block?.remaining || []).map((group) => {
    const isCurrent = Boolean(current && current.mode === group.mode);
    return {
      ...group,
      current: isCurrent,
      cards: (group.maps || []).map((row, index) => {
        const option = isCurrent && block?.can_pick ? options.get(row.map_id) || null : null;
        return {
          ...row, key: cardKey(group.mode, row.map_id), index, option,
          pickable: Boolean(option), selectable: Boolean(option?.allowed), tone: sideTone(row.side),
          statusText: mapStatusText(row),
        };
      }),
    };
  });
}

/**
 * Welche Karten seit dem letzten Stand eine Aktion bekommen haben und kurz aufleuchten: jede Wahl (auch Decider und Vorgabe) und
 * jede Sperre der Gegenseite - die eigene Sperre dimmt nur. Der erste Stand zählt nicht, Zuschauer sehen jede Aktion als neu.
 */
export function freshCards(before: VetoGroup[] | null | undefined, after: VetoGroup[] | null | undefined, own: string | null = null): Set<string> {
  const out = new Set<string>();
  if (!before || !after) return out;
  const was = new Map<string, string | undefined>();
  for (const group of before) for (const row of group.maps || []) was.set(cardKey(group.mode, row.map_id), row.status);
  for (const group of after) {
    for (const row of group.maps || []) {
      const key = cardKey(group.mode, row.map_id);
      if (!was.has(key) || was.get(key) === row.status || row.status === "open" || row.status === "elsewhere") continue;
      if (row.status !== "banned" || !own || row.side !== own) out.add(key);
    }
  }
  return out;
}

/** Ist die Antwort älter als der gezeigte Stand? Serverzeit zuerst, bei gleicher Zeit die Version. */
export function isOlderVeto(current?: VetoBlock | null, next?: VetoBlock | null): boolean {
  if (!current || !next) return false;
  const before = Date.parse(current.server_now || "");
  const after = Date.parse(next.server_now || "");
  if (Number.isFinite(before) && Number.isFinite(after) && after !== before) return after < before;
  return Number(next.version || 0) < Number(current.version || 0);
}

type LivePage = { checkin?: { state?: string | null; veto?: VetoBlock | null } | null; veto_view?: VetoBlock | null };

/**
 * Den kurzen Abruf (`GET /matches/{id}/veto`) in die geladene Matchseite übernehmen: Bleibt der Stand gleich, ersetzt er nur den
 * Veto-Block (Captain: `checkin.veto`, Zuschauer: `veto_view`). Ändert sich der Stand, gibt es `null` - dann lädt die Seite ganz.
 * Eine ältere Antwort ändert nichts: dann kommt `page` selbst zurück.
 */
export function mergeLiveVeto<T extends LivePage>(page: T | null | undefined, live: { veto?: VetoBlock | null; state?: string | null } | null | undefined): T | null {
  if (!page || !live?.veto) return null;
  const shown = page.checkin ? page.checkin.veto : page.veto_view;
  if (isOlderVeto(shown, live.veto)) return page;
  if (page.checkin) {
    if (!shown || shown.status !== live.veto.status || (live.state && live.state !== page.checkin.state)) return null;
    return { ...page, checkin: { ...page.checkin, veto: live.veto } };
  }
  if (shown && shown.status === live.veto.status) return { ...page, veto_view: live.veto };
  return null;
}

/** Die ganze Matchseite neu geladen, aber ihr Veto-Block ist älter als der des kurzen Abrufs: der neuere Block bleibt. */
export function keepNewerVeto<T extends LivePage>(current: T | null | undefined, page: T): T {
  if (!current || !page) return page;
  let out = page;
  const shown = current.checkin?.veto;
  if (page.checkin && shown && page.checkin.veto && isOlderVeto(shown, page.checkin.veto)) {
    out = { ...out, checkin: { ...page.checkin, veto: shown } };
  }
  if (current.veto_view && page.veto_view && isOlderVeto(current.veto_view, page.veto_view)) {
    out = { ...out, veto_view: current.veto_view };
  }
  return out;
}

/** Der Name einer Karte für den Vorleser: Map, Zustand und - wenn antippbar - was das Antippen tut. */
export function cardLabel(card: BoardCard, kind?: string | null): string {
  const base = `${card.name}: ${card.statusText}`;
  if (card.selectable) return `${base} – antippen zum ${kind === "ban" ? "Sperren" : "Wählen"}`;
  if (card.pickable && card.option?.hint) return `${base} – ${card.option.hint}`;
  return base;
}

/** Ob der Veto-Block überhaupt etwas zeigt: vor dem Start nur mit Vorgabe der Woche, fehlender Vorgabe oder „bereit zum Veto?“. */
export function vetoVisible(block?: VetoBlock | null): boolean {
  if (!block) return false;
  if (block.status !== "waiting") return true;
  return Boolean(block.blocked || block.start || block.presets?.length);
}
