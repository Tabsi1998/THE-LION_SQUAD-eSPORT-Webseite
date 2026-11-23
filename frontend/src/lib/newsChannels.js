// Kanal einer News (#1532): wo sie erscheint - Website und App, nur App oder nur Website. Dieselbe Regel wie
// backend/services/news_channels.py: alte News ohne Feld (oder mit kaputtem Wert) gelten als beides.
// Die Website meldet sich bei jedem Aufruf mit der Kopfzeile `X-LSW-Channel: web` (lib/api.js); die App sendet nichts.

export const CHANNEL_HEADER = "X-LSW-Channel";

export const NEWS_CHANNEL_OPTIONS = [
  { k: "both", l: "Website und App" },
  { k: "app", l: "Nur App" },
  { k: "web", l: "Nur Website" },
];

const CHOICE_CHANNELS = { both: ["web", "app"], app: ["app"], web: ["web"] };
const CHOICE_LABELS = Object.fromEntries(NEWS_CHANNEL_OPTIONS.map((option) => [option.k, option.l]));

/** "both" | "app" | "web" - ohne Feld, leer oder unbrauchbar: "both". */
export function channelChoice(channels) {
  if (!Array.isArray(channels)) return "both";
  const found = new Set(channels.filter((value) => value === "web" || value === "app"));
  if (found.size === 1) return found.has("app") ? "app" : "web";
  return "both";
}

/** Die Liste für den Server - in fester Reihenfolge wie dort. */
export function channelsFromChoice(choice) {
  return [...(CHOICE_CHANNELS[choice] || CHOICE_CHANNELS.both)];
}

export function newsChannelLabel(channels) {
  return CHOICE_LABELS[channelChoice(channels)];
}

/** Das kleine Schild in der Liste - nur, wenn die News nicht überall erscheint. */
export function newsChannelBadge(post) {
  const choice = channelChoice(post?.channels);
  return choice === "both" ? null : { key: choice, label: CHOICE_LABELS[choice] };
}

export function isAppOnly(post) {
  return channelChoice(post?.channels) === "app";
}

/** Was die Wahl bewirkt - als Hinweis unter der Auswahl im Editor. */
export function channelHint(choice) {
  if (choice === "app") return "Erscheint nur in der LionsAPP: nicht auf der Website, in der Suche oder bei Google, kein Newsletter und keine Discord-Meldung. Der Link zeigt auf der Website einen Hinweis auf die App.";
  if (choice === "web") return "Erscheint nur auf der Website: nicht in der App (News-Liste, Startseite, Suche) und ohne App-Push. Ein Link öffnet sich trotzdem auch in der App.";
  return "Erscheint auf der Website und in der App – wie bisher.";
}
