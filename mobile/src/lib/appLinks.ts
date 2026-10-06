import { Linking } from "react-native";
import { ownPath } from "./siteUrls";
import { navigateToUrl, navigationRef } from "../navigation/rootNavigation";

// Links von außen (#921): Android reicht Adressen von lionsquad.at an die App weiter (App Links, `app.json`
// `intentFilters` + `assetlinks.json`). Beim Start und während die App läuft öffnet sich der passende Screen; vor
// dem Start der Navigation wird der Link gemerkt. Eine Adresse ohne Screen wird nie an den Browser zurückgegeben -
// Android würde sie sonst gleich wieder der App geben.

let pending: string | null = null;

export type IncomingLinkResult = "screen" | "later" | "none";

export function handleIncomingUrl(url?: string | null): IncomingLinkResult {
  const path = ownPath(url);
  if (path === null) return "none";
  if (!navigationRef.isReady()) {
    pending = path;
    return "later";
  }
  return navigateToUrl(path) ? "screen" : "none";
}

/** Sobald die Navigation steht (`onReady`): den gemerkten Link öffnen. */
export function flushPendingLink(): boolean {
  if (!pending || !navigationRef.isReady()) return false;
  const path = pending;
  pending = null;
  return navigateToUrl(path);
}

/** Beim Start: die Adresse, mit der die App geöffnet wurde, und jede weitere, solange sie läuft. */
export function listenForAppLinks(): () => void {
  Linking.getInitialURL()
    .then((url) => {
      if (url) handleIncomingUrl(url);
    })
    .catch(() => {});
  const subscription = Linking.addEventListener("url", ({ url }) => {
    handleIncomingUrl(url);
  });
  return () => subscription.remove();
}
