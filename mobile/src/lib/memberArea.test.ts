import { applyScope, boardContacts, feeCard, internalLabel, isInternal, linkPrompt, memberEvents, memberNews } from "./memberArea";

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
    { id: "p1", display_title: "Obfrau", user: { display_name: "Paula", username: "paula", avatar_url: "/a.png" } },
    { id: "p2", title_male: "Kassier", user: null },
    { id: "p3", display_title: "Schriftführer", is_active: false, user: { username: "x" } },
    { id: "p4", title_male: "Beirat", user: { gamertag: "Gamer1" } },
    { id: "p5", title_male: "Beirat", user: { username: "u5" } },
    { id: "p6", title_male: "Beirat", user: { username: "u6" } },
    { id: "p7", title_male: "Beirat", user: { username: "u7" } },
  ];
  const contacts = boardContacts(positions);
  expect(contacts).toHaveLength(4);
  expect(contacts[0]).toEqual({ id: "p1", title: "Obfrau", name: "Paula", avatar: "/a.png", username: "paula" });
  expect(contacts[1]).toEqual({ id: "p4", title: "Beirat", name: "Gamer1", avatar: "", username: null });
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
