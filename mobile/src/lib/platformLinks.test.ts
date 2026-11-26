import { targetFromUrl } from "../navigation/rootNavigation";
import { platformLinkUrl } from "./platformLinks";

// Konten verknüpfen (#521, #2059): das läuft auf der Website (die Plattform bestätigt das Konto). Die Adresse darf darum
// kein App-Link sein - sonst öffnete Android wieder die App und Discord, Twitch oder Steam ließen sich nie verknüpfen. Nach
// der Plattform führt die Website zurück auf /profile?tab=socials&linked=… - das ist ein App-Link und öffnet „Profil
// bearbeiten“ in der App.

type Filter = { host: string; path?: string; pathPrefix?: string };
const { expo } = require("../../app.json");
const data = expo.android.intentFilters[0].data as Filter[];

function istAppLink(url: string): boolean {
  const { host, pathname } = new URL(url);
  return data.some((entry) => entry.host === host && (entry.path === pathname || Boolean(entry.pathPrefix && pathname.startsWith(entry.pathPrefix))));
}

test("Verknüpfen öffnet die Website an der Stelle Profil → Socials - und die Adresse ist kein App-Link", () => {
  for (const platform of ["discord", "twitch", "steam", "bluesky"]) {
    const url = platformLinkUrl(platform);
    expect(new URL(url).pathname).toBe("/mein-bereich/profil");
    expect(new URL(url).searchParams.get("tab")).toBe("socials");
    expect(new URL(url).searchParams.get("link")).toBe(platform);
    expect([url, istAppLink(url.replace(/^https?:\/\/[^/]+/, "https://lionsquad.at"))]).toEqual([url, false]);
    expect(istAppLink(url.replace(/^https?:\/\/[^/]+/, "https://www.lionsquad.at"))).toBe(false);
  }
  expect(platformLinkUrl("a b&c")).toMatch(/link=a%20b%26c$/);
});

test("zurück von der Plattform: /profile?tab=socials&linked=… ist ein App-Link und öffnet „Profil bearbeiten“", () => {
  expect(istAppLink("https://lionsquad.at/profile")).toBe(true);
  expect(targetFromUrl("https://lionsquad.at/profile?tab=socials&linked=discord")).toEqual({ kind: "detail", screen: "ProfileEdit", params: undefined });
  expect(targetFromUrl("https://lionsquad.at/profile?tab=socials&link_error=denied")).toEqual({ kind: "detail", screen: "ProfileEdit", params: undefined });
});
