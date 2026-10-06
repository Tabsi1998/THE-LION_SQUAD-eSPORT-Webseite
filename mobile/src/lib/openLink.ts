import { Linking } from "react-native";
import { WEB_BASE_URL, ownPath } from "./siteUrls";
import { navigateToUrl } from "../navigation/rootNavigation";

// Ein Weg für alle Links in der App (#921): zeigt die App die Seite selbst (Turnier, Event, Match, Fast Lap, Team,
// News, Profil, Galerie, Erfolge, Jahreswertung, Rechnungen …), geht genau dieser Screen auf. Andere Seiten der
// eigenen Website und fremde Adressen öffnen sich im Browser. Geöffnet wird nur, was mit http oder https beginnt.

export type LinkResult = "screen" | "browser" | "none";

export function openLink(url?: string | null): LinkResult {
  const text = String(url || "").trim();
  const path = ownPath(text);
  if (path !== null && navigateToUrl(path)) return "screen";
  const address = path !== null ? `${WEB_BASE_URL}${path}` : text;
  if (!/^https?:\/\//i.test(address)) return "none";
  Linking.openURL(address).catch(() => {});
  return "browser";
}
