import type { UserNotification } from "../types";

// In-App-Banner (#251): höchstens einer sichtbar, kurz hintereinander
// eintreffende Meldungen werden gebündelt, im offenen Chat mit derselben
// Person kommt keine Meldung für ihre Nachricht. Reine Entscheidungen, damit
// sie ohne Gerät testbar sind.

export const POPUP_BUNDLE_WINDOW_MS = 3000;
export const POPUP_AUTO_HIDE_MS = 5000;

export type PopupState = {
  items: UserNotification[];
  shownAt: number;
};

/** Neue Meldung zum Banner: innerhalb von drei Sekunden wird gebündelt, sonst ersetzt. */
export function mergePopup(current: PopupState | null, item: UserNotification, now = Date.now()): PopupState {
  if (current && now - current.shownAt < POPUP_BUNDLE_WINDOW_MS) {
    const items = [item, ...current.items.filter((row) => row.id !== item.id)];
    return { items, shownAt: current.shownAt };
  }
  return { items: [item], shownAt: now };
}

export function popupTitle(state: PopupState) {
  const [latest] = state.items;
  if (state.items.length > 1) return `${state.items.length} neue Benachrichtigungen`;
  return latest?.title || "Benachrichtigung";
}

export function popupBody(state: PopupState) {
  const [latest] = state.items;
  if (!latest) return "";
  if (state.items.length > 1) return latest.title || latest.body || "";
  return latest.body || "";
}

type CurrentRoute = { name?: string; params?: Record<string, unknown> | undefined } | null | undefined;

/**
 * Im offenen Chat mit derselben Person (Direktnachricht) oder im selben
 * Team-/Turnier-Chat ist der Banner überflüssig - die Nachricht steht schon da.
 */
export function suppressedByOpenChat(item: UserNotification, route: CurrentRoute) {
  if (!route?.name) return false;
  const meta = (item.meta || {}) as Record<string, unknown>;
  const kind = String(item.kind || "").toLowerCase();
  const params = (route.params || {}) as Record<string, unknown>;
  if (route.name === "DirectThread" && kind.includes("direct_message")) {
    return Boolean(meta.thread_user_id) && String(meta.thread_user_id) === String(params.userId || "");
  }
  if (route.name === "TeamChat" && kind.includes("team_chat")) {
    return Boolean(meta.team_id) && String(meta.team_id) === String(params.id || "");
  }
  if (route.name === "TournamentChat" && kind.includes("tournament_chat")) {
    return Boolean(meta.tournament_id) && String(meta.tournament_id) === String(params.id || "");
  }
  return false;
}
