import { applyScope, areaCard, boardContacts, feeAmount, feeBadge, feeCard, feesStandLine, internalLabel, isInternal, linkPrompt, memberEvents, memberNews, tileNote } from "./memberArea";

// Mitgliederbereich in der App (#340, #339, #342): dieselbe Auswahl wie im Web.

const now = new Date("2026-09-22T10:00:00Z");

test("interne Events: nur members/internal, nur Anstehende, nach Datum", () => {
  const events = [
    { id: "spät", visibility: "members", start_date: "2026-10-05T18:00:00Z" },
    { id: "öffentlich", visibility: "public", start_date: "2026-09-23T18:00:00Z" },
    { id: "früh", visibility: "internal", start_date: "2026-09-25T18:00:00Z" },
    { id: "vorbei", visibility: "members", start_date: "2026-09-01T18:00:00Z", end_date: "2026-09-02T18:00:00Z" },
    { id: "läuft", visibility: "members", start_date: "2026-09-21T18:00:00Z", end_date: "2026-09-23T18:00:00Z" },
    { id: "ohne Termin", visibility: "members" },
  ];
  expect(memberEvents(events, now).map((event) => event.id)).toEqual(["läuft", "früh", "spät", "ohne Termin"]);
  expect(memberEvents(null, now)).toEqual([]);
});

test("interne News: nur members/internal, höchstens drei", () => {
  const posts = [{ id: "a", visibility: "members" }, { id: "b", visibility: "public" }, { id: "c", visibility: "internal" }, { id: "d", visibility: "members" }, { id: "e", visibility: "members" }];
  expect(memberNews(posts).map((post) => post.id)).toEqual(["a", "c", "d"]);
});

test("Kennzeichen: Intern für Mitglieder, Vorstand für internal, sonst keins", () => {
  expect(internalLabel({ visibility: "members" })).toBe("Intern");
  expect(internalLabel({ visibility: "internal" })).toBe("Vorstand");
  expect(internalLabel({ visibility: "public" })).toBeNull();
  expect(internalLabel(null)).toBeNull();
  expect(isInternal({ visibility: "community" })).toBe(false);
});

test("Filter „Verein“ lässt nur Interne durch, „Alle“ alles", () => {
  const items = [{ visibility: "public" }, { visibility: "members" }];
  expect(applyScope(items, "club")).toEqual([{ visibility: "members" }]);
  expect(applyScope(items, "all")).toBe(items);
});

test("Ansprechpartner: nur besetzte, aktive Posten, höchstens vier", () => {
  const positions = [
    { id: "p1", display_title: "Obfrau", user: { display_name: "Paula", username: "paula", avatar_url: "/a.png", gamertag: "PaulaPlays" } },
    { id: "p2", title_male: "Kassier", user: null },
    { id: "p3", display_title: "Schriftführer", is_active: false, user: { username: "x" } },
    { id: "p4", title_male: "Beirat", user: { gamertag: "Gamer1" } },
    { id: "p5", title_male: "Beirat", user: { username: "u5" } },
    { id: "p6", title_male: "Beirat", user: { username: "u6" } },
    { id: "p7", title_male: "Beirat", user: { username: "u7" } },
  ];
  const contacts = boardContacts(positions);
  expect(contacts).toHaveLength(4);
  expect(contacts[0]).toEqual({ id: "p1", title: "Obfrau", name: "Paula", avatar: "/a.png", username: "paula", gamertag: "PaulaPlays" });
  // Der Spielername nur, wenn er anders lautet als der Name (#1332).
  expect(contacts[1]).toEqual({ id: "p4", title: "Beirat", name: "Gamer1", avatar: "", username: null, gamertag: "" });
});

test("Beitragskarte sagt dasselbe wie die Website", () => {
  const card = feeCard({
    connected: true, led_by_dolibarr: true, as_of: "2026-09-22T08:00:00Z", stale: false, paid_until: "2026-12-31",
    fee: { required: true, status: "due", next_due: "2026-09-01", amount: 20, currency: "EUR", discount: { kind: "student", label: "Schüler:in" }, payer: "self" },
  });
  expect(card).not.toBeNull();
  expect(card!.label).toBe("fällig");
  expect(card!.tone).toBe("warn");
  expect(card!.amount).toMatch(/20,00/);
  expect(card!.lines).toEqual(["Bezahlt bis 31.12.2026", "Nächster Beitrag seit 1.9.2026 offen", "Ermäßigung: Schüler:in"]);
  expect(feeCard({ connected: true, led_by_dolibarr: false })).toBeNull();
  expect(feeCard({ connected: true, led_by_dolibarr: true, fee: { required: false, status: "not_required" }, membership_ends: "2026-12-31" })!.lines).toEqual(["Mitgliedschaft endet am 31.12.2026"]);
});

test("Zuordnung anfragen nur, wenn angebunden und noch nicht geführt", () => {
  expect(linkPrompt(null)).toBeNull();
  expect(linkPrompt({ connected: false })).toBeNull();
  expect(linkPrompt({ connected: true, led_by_dolibarr: true })).toBeNull();
  expect(linkPrompt({ connected: true, led_by_dolibarr: false })).toBe("ask");
  expect(linkPrompt({ connected: true, led_by_dolibarr: false, link: { status: "requested" } })).toBe("requested");
  expect(linkPrompt({ connected: true, led_by_dolibarr: false, link: { status: "conflict" } })).toBe("conflict");
});

// Karte oben im Tab „Verein“ (#1336) und die Zahlen an den Kacheln (#1257) - dieselben Regeln wie im Web.
test("Schild zum Beitrag: bezahlt, offen, nicht nötig, ruht - ohne Mitgliederverwaltung keins", () => {
  const view = (status: string) => ({ led_by_dolibarr: true, fee: { status } });
  expect(feeBadge(view("paid"))).toEqual({ tone: "ok", text: "Beitrag bezahlt" });
  expect(feeBadge(view("invoiced"))).toEqual({ tone: "warn", text: "Beitrag offen" });
  expect(feeBadge(view("due"))).toEqual({ tone: "warn", text: "Beitrag offen" });
  expect(feeBadge(view("not_required"))?.text).toBe("Kein Beitrag nötig");
  expect(feeBadge(view("inactive"))?.text).toBe("Beitrag ruht");
  expect(feeBadge({ led_by_dolibarr: false, fee: { status: "paid" } })).toBeNull();
  expect(feeBadge(null)).toBeNull();
});

test("Karte: nur für eine gültige Mitgliedschaft, Art ausgeschrieben, gültig bis = Austritt, sonst bezahlt bis", () => {
  const user = { display_name: "NeonFalke", username: "neon" };
  const membership = { member_status: "active", member_number: "TLS-0007", member_since: "2023-03-01", membership_type: "youth" };
  expect(areaCard(user, membership, { paid_until: "2026-12-31" })).toEqual({ name: "NeonFalke", number: "TLS-0007", since: "2023-03-01", typeLabel: "Jugendmitglied", validUntil: "2026-12-31" });
  expect(areaCard(user, membership, { type_label: "Fördermitglied", membership_ends: "2026-11-30", paid_until: "2026-12-31" })).toMatchObject({ typeLabel: "Fördermitglied", validUntil: "2026-11-30" });
  expect(areaCard(user, { member_status: "honorary" }, { member_ref: "M-12" })).toMatchObject({ number: "M-12", typeLabel: "Mitglied" });
  expect(areaCard(user, { member_status: "pending" }, null)).toBeNull();
  expect(areaCard(user, null, null)).toBeNull();
});

test("Zahlen an den Kacheln: offen, frei, neu - ohne Offenes keine", () => {
  const summary = { meetings_open: 1, helping_free: 6, news_new: 0, documents_new: 2 };
  expect(tileNote("meetings", summary)).toBe("1 offen");
  expect(tileNote("helping", summary)).toBe("6 frei");
  expect(tileNote("news", summary)).toBe("");
  expect(tileNote("documents", summary)).toBe("2 neu");
  expect(tileNote("benefits", summary)).toBe("");
  expect(tileNote("meetings", null)).toBe("");
});

// Beitrag offen (#1251): dieselben Beträge wie auf „Mitglied werden“ der Website.
test("Beitrag je Mitgliedsart und der Stand, wenn die Verwaltung nicht antwortet", () => {
  expect(feeAmount({ id: 2, label: "Ordentlich", amount: 60, currency: "EUR", period_label: "je Jahr", subscription_required: true })).toMatch(/60,00 je Jahr$/);
  expect(feeAmount({ id: 3, label: "Ehrenmitglied", amount: null, subscription_required: false })).toBe("Ohne Beitrag");
  expect(feesStandLine({ available: true, stale: true, as_of: "2026-10-07T08:00:00Z", fees: [] })).toBe("Stand 7.10.2026 – die Mitgliederverwaltung antwortet gerade nicht.");
  expect(feesStandLine({ available: true, stale: false, as_of: "2026-10-07T08:00:00Z", fees: [] })).toBe("");
  expect(feesStandLine(null)).toBe("");
});
