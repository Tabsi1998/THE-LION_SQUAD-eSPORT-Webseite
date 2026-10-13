import { WEB_BASE_URL } from "./siteUrls";

// Eine Herkunfts-Matrix für alle Linkparser der App (#998): Render (RichText/contentLinks), Benachrichtigungen
// (rootNavigation) und Links von außen (appLinks/openLink) prüfen dieselben Adressen. Jede führt auf die News
// „external-article“ - nur die eigenen dürfen dort ankommen.

export const ARTICLE = "external-article";

/** Eigene Website: Server, lionsquad.at mit und ohne www, Groß-/Kleinschreibung, und der relative Pfad. */
export const OWN_ARTICLE_LINKS = [
  `/news/${ARTICLE}`,
  `${WEB_BASE_URL}/news/${ARTICLE}`,
  `https://lionsquad.at/news/${ARTICLE}`,
  `https://www.lionsquad.at/news/${ARTICLE}`,
  `HTTPS://LIONSQUAD.AT/news/${ARTICLE}`,
  // Der Standard-Port gehört zur Origin dazu.
  `https://lionsquad.at:443/news/${ARTICLE}`,
];

/** Fremde Herkunft mit demselben Pfad - nie ein Screen der App. */
export const FOREIGN_ARTICLE_LINKS = [
  `https://evil.example/news/${ARTICLE}`,
  `http://evil.example/news/${ARTICLE}`,
  // Protokoll-relativ: der Browser setzt nur das Schema davor, der Host bleibt fremd.
  `//evil.example/news/${ARTICLE}`,
  `//news/${ARTICLE}`,
  `///news/${ARTICLE}`,
  // Schrägstrich-Spielarten, die ein URL-Parser wie „//“ liest.
  `/\\evil.example/news/${ARTICLE}`,
  `\\\\evil.example/news/${ARTICLE}`,
  `/\t/evil.example/news/${ARTICLE}`,
  // Eigene Domain nur als Teil eines fremden Hosts, als Anmeldename oder in der Abfrage.
  `https://lionsquad.at.evil.example/news/${ARTICLE}`,
  `https://lionsquad.at@evil.example/news/${ARTICLE}`,
  `https://evil.example\\@lionsquad.at/news/${ARTICLE}`,
  `https://evil.example/?u=https://lionsquad.at/news/${ARTICLE}`,
  // Eigener Host, aber andere Origin (Codex-Prüfung #1512): fremder Port, http statt https, Anmeldedaten.
  `https://lionsquad.at:4444/news/${ARTICLE}`,
  `https://www.lionsquad.at:8443/news/${ARTICLE}`,
  `http://lionsquad.at/news/${ARTICLE}`,
  `http://www.lionsquad.at/news/${ARTICLE}`,
  `http://lionsquad.at:443/news/${ARTICLE}`,
  `https://gast:geheim@lionsquad.at/news/${ARTICLE}`,
  // Die Server-Adresse nur mit genau ihrem Schema und Port.
  `${WEB_BASE_URL.replace(/:\d+$/, "")}:9999/news/${ARTICLE}`,
  `${WEB_BASE_URL.startsWith("http:") ? WEB_BASE_URL.replace(/^http:/, "https:") : WEB_BASE_URL.replace(/^https:/, "http:")}/news/${ARTICLE}`,
  // Andere Schemata.
  `javascript:alert(1)//news/${ARTICLE}`,
  `lionsquad://news/${ARTICLE}`,
];
