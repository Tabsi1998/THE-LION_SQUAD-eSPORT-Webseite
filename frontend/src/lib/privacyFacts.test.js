import { analyticsText, emailProviderText, hostingText, normalizeFacts, privacySections } from "./privacyFacts";

// Datenschutzerklärung aus den echten Schaltern (Rechtliches II): welche Abschnitte, welche Worte.

test("ohne Angaben gelten sichere Standardwerte, kaputte Teile werden ergänzt", () => {
  const facts = normalizeFacts(undefined);
  expect(facts.analytics).toBe("");
  expect(facts.discord).toEqual({ webhooks: false, bot: false });
  expect(normalizeFacts({ discord: { bot: true } }).discord).toEqual({ webhooks: false, bot: true });
  expect(normalizeFacts({ app: {} }).app.crash_reports).toBe(true);
});

test("Abschnitte erscheinen nur, wenn der Dienst wirklich an ist", () => {
  expect(privacySections({})).toEqual(["account", "email", "analytics", "app"]);
  expect(privacySections({ discord: { webhooks: true }, twitch_embed: true, dolibarr: true }))
    .toEqual(["account", "email", "discord", "analytics", "twitch", "dolibarr", "app"]);
  expect(privacySections({ discord: { bot: true } })).toContain("discord");
});

test("die Texte nennen den echten Anbieter statt einer Möglichkeitsform", () => {
  expect(emailProviderText("resend")).toContain("Resend");
  expect(emailProviderText("smtp")).toContain("eigenen Mailserver");
  expect(emailProviderText("none")).toContain("kein E-Mail-Versand");
  expect(analyticsText("google")).toContain("Google Analytics 4");
  expect(analyticsText("plausible")).toContain("ohne Cookies");
  expect(analyticsText("")).toContain("keinen Statistik- oder Tracking-Dienst");
  expect(hostingText({ provider: "Eigenhosting", country: "Österreich" })).toBe("Die Website läuft auf eigener Infrastruktur des Vereins (Österreich).");
  expect(hostingText({ provider: "Hetzner", country: "" })).toBe("Die Website wird bei Hetzner betrieben; der Anbieter ist Auftragsverarbeiter.");
  expect(hostingText({})).toBe("");
});
