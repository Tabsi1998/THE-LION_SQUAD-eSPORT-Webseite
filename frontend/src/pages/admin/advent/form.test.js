import { closesInput, dayText, defaultMoment, defaultYear, emptyForm, formFromDoor, missing, payloadFromForm, pickupLabel, previewContent, previewMoments, stampText, yearOptions } from "./form";

// Pflege des Adventkalenders (#641): aus dem gespeicherten Türchen wird das Formular, aus dem Formular genau das,
// was zur gewählten Art gehört.

const QUIZ = { question: "Wie viele Kerzen?", answers: ["Drei", "Vier", "Fünf"], correct: 1, explanation: "Eine je Sonntag." };

test("leeres Formular und ein gespeichertes Türchen", () => {
  expect(formFromDoor(null)).toEqual(emptyForm());
  expect(emptyForm().quiz.answers).toEqual(["", "", ""]);
  const form = formFromDoor({ kind: "quiz", title: "Quiz", body: "Text", quiz: QUIZ, link_url: "/news", link_label: "Zu den News", media_url: "/api/static/uploads/a.webp" });
  expect(form).toMatchObject({ kind: "quiz", title: "Quiz", body: "Text", quiz: QUIZ, link_url: "/news", link_label: "Zu den News", media_url: "/api/static/uploads/a.webp", ref_id: "", sticker_id: "" });
  const prize = formFromDoor({ kind: "prize", title: "Gewinn", prize: { prize_label: "Hoodie", prize_value: "Größe nach Wahl", winners: 2, audience: "members", closes_at: "2026-12-13T20:00:00+01:00", staff_may_enter: true } });
  expect(prize.prize).toEqual({ label: "Hoodie", value: "Größe nach Wahl", winners: 2, audience: "members", closes_at: "2026-12-13T20:00", staff_may_enter: true });
  // Kopiert aus dem Vorjahr: der Gewinn kommt ohne Teilnahmeschluss, die Einwilligung ohne Haken.
  expect(formFromDoor({ kind: "prize", title: "x", prize: { prize_label: "Hoodie", winners: 1, audience: "all" } }).prize.closes_at).toBe("");
  expect(formFromDoor({ kind: "member_spotlight", title: "x", ref_id: "p1", consent_confirmed: false })).toMatchObject({ ref_id: "p1", consent_confirmed: false });
  expect(formFromDoor({ kind: "sticker", title: "x", sticker: { id: "s1", url: "/x.png" } }).sticker_id).toBe("s1");
  expect(formFromDoor({ kind: "quiz", title: "x", quiz: { question: "?", answers: ["a"], correct: "1" } }).quiz).toEqual({ question: "?", answers: ["a", "", ""], correct: null, explanation: "" });
});

test("Teilnahmeschluss als Eingabe: Wiener Zeit, egal in welcher Zone die Angabe kommt", () => {
  expect(closesInput("2026-12-13T20:00:00+01:00")).toBe("2026-12-13T20:00");
  expect(closesInput("2026-12-13T19:00:00Z")).toBe("2026-12-13T20:00");
  expect(closesInput("2027-01-06T23:59:59+01:00")).toBe("2027-01-06T23:59");
  expect(closesInput("")).toBe("");
  expect(closesInput("irgendwann")).toBe("");
});

test("an den Server geht nur, was zur Art gehört", () => {
  const form = { ...emptyForm(), title: "  Titel  ", body: " Text ", video_url: "https://youtu.be/dQw4w9WgXcQ", clip_url: "https://clips.twitch.tv/abc", ref_id: "n1", sticker_id: "s1", consent_confirmed: true, quiz: QUIZ, prize: { label: " Hoodie ", value: "", winners: "2", audience: "all", closes_at: "2026-12-13T20:00", staff_may_enter: false } };
  expect(payloadFromForm({ ...form, kind: "text" })).toEqual({ kind: "text", title: "Titel", body: "Text" });
  expect(payloadFromForm({ ...form, kind: "video" })).toEqual({ kind: "video", title: "Titel", body: "Text", video_url: "https://youtu.be/dQw4w9WgXcQ" });
  expect(payloadFromForm({ ...form, kind: "clip" })).toEqual({ kind: "clip", title: "Titel", body: "Text", clip_url: "https://clips.twitch.tv/abc" });
  expect(payloadFromForm({ ...form, kind: "news" })).toEqual({ kind: "news", title: "Titel", body: "Text", ref_id: "n1" });
  expect(payloadFromForm({ ...form, kind: "member_spotlight" })).toEqual({ kind: "member_spotlight", title: "Titel", body: "Text", ref_id: "n1", consent_confirmed: true });
  expect(payloadFromForm({ ...form, kind: "sticker", media_url: "/api/static/uploads/a.webp" })).toEqual({ kind: "sticker", title: "Titel", body: "Text", sticker_id: "s1" });
  expect(payloadFromForm({ ...form, kind: "quiz" })).toEqual({ kind: "quiz", title: "Titel", body: "Text", quiz: QUIZ });
  expect(payloadFromForm({ ...form, kind: "prize" })).toEqual({ kind: "prize", title: "Titel", body: "Text", prize: { label: "Hoodie", value: "", winners: 2, audience: "all", staff_may_enter: false, closes_at: "2026-12-13T20:00" } });
  expect(payloadFromForm({ ...form, kind: "prize", prize: { ...form.prize, closes_at: "" } }).prize).not.toHaveProperty("closes_at");
  expect(payloadFromForm({ ...form, kind: "image", media_url: "/api/static/uploads/a.webp", link_url: " /news ", link_label: " Zu den News " })).toEqual({ kind: "image", title: "Titel", body: "Text", media_url: "/api/static/uploads/a.webp", link_url: "/news", link_label: "Zu den News" });
  expect(payloadFromForm({ ...form, kind: "text", link_url: "/news", link_label: " " })).toEqual({ kind: "text", title: "Titel", body: "Text", link_url: "/news" });
});

test("was vor dem Speichern fehlt", () => {
  const base = { ...emptyForm(), title: "Titel" };
  expect(missing({ ...emptyForm(), body: "x" })).toBe("Das Türchen braucht einen Titel.");
  expect(missing(base)).toBe("Ein Text-Türchen braucht einen Text.");
  expect(missing({ ...base, body: "Text" })).toBe("");
  expect(missing({ ...base, kind: "image" })).toBe("Ein Bild-Türchen braucht ein Bild.");
  expect(missing({ ...base, kind: "video" })).toBe("Bitte die Adresse des Videos eintragen.");
  expect(missing({ ...base, kind: "clip" })).toBe("Bitte die Adresse des Clips eintragen.");
  expect(missing({ ...base, kind: "news" })).toBe("Bitte einen News-Beitrag auswählen.");
  expect(missing({ ...base, kind: "event" })).toBe("Bitte ein Event auswählen.");
  expect(missing({ ...base, kind: "member_spotlight" })).toBe("Bitte ein Mitglied auswählen.");
  expect(missing({ ...base, kind: "member_spotlight", ref_id: "p1" })).toBe("Bitte bestätigen, dass das Mitglied einverstanden ist.");
  expect(missing({ ...base, kind: "member_spotlight", ref_id: "p1", consent_confirmed: true })).toBe("");
  expect(missing({ ...base, kind: "sticker" })).toBe("Bitte einen Sticker auswählen.");
  expect(missing({ ...base, kind: "quiz" })).toBe("Das Quiz braucht eine Frage.");
  expect(missing({ ...base, kind: "quiz", quiz: { ...QUIZ, answers: ["a", " ", "c"] } })).toBe("Das Quiz braucht drei Antworten.");
  expect(missing({ ...base, kind: "quiz", quiz: { ...QUIZ, correct: null } })).toBe("Bitte die richtige Antwort markieren.");
  expect(missing({ ...base, kind: "quiz", quiz: QUIZ })).toBe("");
  expect(missing({ ...base, kind: "prize" })).toBe("Der Gewinn braucht einen Namen.");
  expect(missing({ ...base, kind: "prize", prize: { ...base.prize, label: "Hoodie" } })).toBe("");
});

test("Jahr und Jahre zur Auswahl: im Jänner noch der Kalender vom Dezember davor", () => {
  expect(defaultYear(new Date(2026, 8, 30))).toBe(2026);
  expect(defaultYear(new Date(2026, 11, 24))).toBe(2026);
  expect(defaultYear(new Date(2027, 0, 3))).toBe(2026);
  expect(defaultYear(new Date(2027, 1, 1))).toBe(2027);
  expect(yearOptions([2025, 2026], new Date(2026, 8, 30))).toEqual([2027, 2026, 2025]);
  expect(yearOptions(undefined, new Date(2027, 0, 3))).toEqual([2027, 2026]);
  expect(yearOptions(["2024", 0, null], new Date(2026, 8, 30))).toEqual([2027, 2026, 2024]);
});

test("Tage und Zeitpunkte der Vorschau", () => {
  expect(dayText(2026, 1)).toBe("Di, 1. Dezember");
  expect(dayText(2026, 24)).toBe("Do, 24. Dezember");
  expect(dayText(2027, 5)).toBe("So, 5. Dezember");
  const moments = previewMoments(2026);
  expect(moments).toHaveLength(25);
  expect(moments[0]).toEqual({ key: "2026-12-01T09:00:00", label: "Di, 1. Dezember – Türchen 1 ist das neueste" });
  expect(moments[24]).toEqual({ key: "2026-12-27T09:00:00", label: "Nachholzeit – alle Türchen sind offen" });
  expect(defaultMoment(2026, new Date(2026, 11, 12, 10))).toBe("2026-12-12T09:00:00");
  expect(defaultMoment(2026, new Date(2026, 8, 30))).toBe("2026-12-24T09:00:00");
  expect(defaultMoment(2026, new Date(2026, 11, 28))).toBe("2026-12-24T09:00:00");
  expect(defaultMoment(2027, new Date(2026, 11, 12))).toBe("2027-12-24T09:00:00");
});

test("Texte für das Protokoll", () => {
  expect(["pending", "ready", "picked_up", "expired", "anders", undefined].map(pickupLabel)).toEqual(["vorgemerkt", "abholbereit", "übergeben", "verfallen", "offen", "offen"]);
  expect(stampText("2026-12-09T19:05:00+00:00")).toBe("9.12.2026, 20:05 Uhr");
  expect(stampText("")).toBe("");
});

test("Vorschau ohne Speichern: der Inhalt aus dem Formular", () => {
  const options = { news: [{ id: "n1", label: "Wintercup", hint: "4.12.2026" }], members: [{ id: "p1", label: "Pauli", hint: "Kapitänin" }], stickers: [{ id: "pack", name: "Löwe", stickers: [{ id: "s1", name: "Jubel", url: "/s1.png" }] }] };
  const base = { ...emptyForm(), title: " Titel ", body: " Text " };
  expect(previewContent(base, options, 5)).toEqual({ kind: "text", title: "Titel", body: "Text", media_url: null, link: null });
  expect(previewContent({ ...emptyForm() }, options, 5).title).toBe("Türchen 5");
  expect(previewContent({ ...base, link_url: "/news" }, options).link).toEqual({ url: "/news", label: "Mehr dazu" });
  expect(previewContent({ ...base, kind: "video", video_url: "https://youtu.be/dQw4w9WgXcQ" }, options).video).toEqual({ url: "https://youtu.be/dQw4w9WgXcQ" });
  expect(previewContent({ ...base, kind: "clip", clip_url: "https://www.twitch.tv/lion/clip/GoodOne-xyz" }, options).clip).toEqual({ id: "GoodOne-xyz", url: "https://clips.twitch.tv/GoodOne-xyz" });
  expect(previewContent({ ...base, kind: "clip", clip_url: "kein clip" }, options).clip).toBeNull();
  expect(previewContent({ ...base, kind: "news", ref_id: "n1" }, options).card).toMatchObject({ title: "Wintercup" });
  expect(previewContent({ ...base, kind: "news", ref_id: "fehlt" }, options)).toMatchObject({ kind: "text" });
  // Mitglied der Woche: ohne Haken zeigt auch die Vorschau die Person nicht.
  expect(previewContent({ ...base, kind: "member_spotlight", ref_id: "p1" }, options)).not.toHaveProperty("card");
  expect(previewContent({ ...base, kind: "member_spotlight", ref_id: "p1", consent_confirmed: true }, options).card).toMatchObject({ name: "Pauli", role: "Kapitänin" });
  expect(previewContent({ ...base, kind: "sticker", sticker_id: "s1", media_url: "/x.webp" }, options)).toMatchObject({ media_url: null, sticker: { id: "s1", name: "Jubel" } });
  expect(previewContent({ ...base, kind: "quiz", quiz: QUIZ }, options).quiz).toEqual({ question: "Wie viele Kerzen?", answers: ["Drei", "Vier", "Fünf"], done: false });
  expect(previewContent({ ...base, kind: "prize", prize: { ...base.prize, label: "Hoodie", winners: "3" } }, options).prize).toMatchObject({ label: "Hoodie", winners: 3, status: "open", entries: 0, can_enter: true });
});
