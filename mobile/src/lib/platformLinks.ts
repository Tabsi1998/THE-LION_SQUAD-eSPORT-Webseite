import { WEB_BASE_URL } from "./siteUrls";

// Konten verknüpfen aus der App (#521, #2059): Discord, Twitch, Steam & Co. bestätigen das Konto auf der Website - die App
// öffnet dafür Mein Bereich → Profil → Socials mit `link=<plattform>`, und die Website startet die Anmeldung gleich. Die
// Adresse ist bewusst kein App-Link (app.json): sonst öffnete Android wieder die App, und nichts ließe sich verknüpfen. Nach
// der Plattform führt die Website auf /profile?tab=socials&linked=… zurück - das ist ein App-Link und öffnet „Profil
// bearbeiten“ (navigation/rootNavigation.ts). Ein Test (platformLinks.test.ts) hält beides fest.

export function platformLinkUrl(platform: string): string {
  return `${WEB_BASE_URL}/mein-bereich/profil?tab=socials&link=${encodeURIComponent(platform)}`;
}
