import { bugReportUrl, INVOICE_QUESTION_URL } from "./contactLinks";
import { WEB_BASE_URL } from "./siteUrls";

// Kontakt mit Thema (#2131 KO9/FI13, Nachzug #2173): „Fehler melden“ bringt Seite und Version mit, die Rechnungsfrage ihr Thema.

test("Fehler melden: Thema report_bug, Bildschirm als Pfad /app/<name>, Version der App", () => {
  const url = new URL(bugReportUrl("MatchDetail", "1.7.14"));
  expect(`${url.protocol}//${url.host}`).toBe(new URL(WEB_BASE_URL).origin);
  expect(url.pathname).toBe("/contact");
  expect(url.searchParams.get("topic")).toBe("report_bug");
  expect(url.searchParams.get("from")).toBe("/app/matchdetail");
  expect(url.searchParams.get("version")).toBe("1.7.14");
  expect(url.searchParams.get("subject")).toBe("Fehler in der App");
});

test("Fehler melden: nichts Fremdes in der Adresse - kein Bildschirm mit Sonderzeichen, keine seltsame Version", () => {
  const url = new URL(bugReportUrl("Profil/../geheim?x=1", "1.7 beta<script>"));
  expect(url.searchParams.get("from")).toBe("/app/profilgeheimx1");
  expect(url.searchParams.has("version")).toBe(false);
  expect(new URL(bugReportUrl("", "")).searchParams.get("from")).toBe("/app");
});

test("Frage zur Rechnung: Thema invoice mit Betreff", () => {
  const url = new URL(INVOICE_QUESTION_URL);
  expect(url.pathname).toBe("/contact");
  expect(url.searchParams.get("topic")).toBe("invoice");
  expect(url.searchParams.get("subject")).toBe("Frage zu meiner Rechnung");
});
