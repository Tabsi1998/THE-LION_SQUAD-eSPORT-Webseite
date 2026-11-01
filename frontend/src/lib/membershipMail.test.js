import { exitLine, listLimitHint, mailOutcome, statusChangeSentence } from "./membershipMail";

test("die Meldung sagt ehrlich, ob die Mail draußen ist (#2125)", () => {
  expect(mailOutcome("queued")).toEqual({ sent: true, text: "Die Mail an die Person ist unterwegs." });
  expect(mailOutcome("skipped").sent).toBe(true);
  for (const state of ["no_address", "mail_off", "failed"]) expect(mailOutcome(state).sent).toBe(false);
  expect(mailOutcome("no_address").text).toContain("keine Adresse");
  expect(mailOutcome("mail_off").text).toContain("nicht versandt");
  expect(mailOutcome(null)).toEqual({ sent: true, text: "" });
});

test("die Rückfrage nennt die Mail oder sagt, dass keine hinausgeht", () => {
  expect(statusChangeSentence({ name: "Erika", statusLabel: "Ehemalig", status: "former", notify: true })).toBe("Erika wird „Ehemalig“. Erika bekommt die Mail „Mitgliedschaft beendet“ und eine Meldung.");
  expect(statusChangeSentence({ name: "Erika", statusLabel: "Ehemalig", status: "former", notify: false })).toBe("Erika wird „Ehemalig“. Erika bekommt keine Mail und keine Meldung.");
  expect(statusChangeSentence({ name: "Erika", statusLabel: "Kein Mitglied", status: "none", notify: true })).toBe("Erika wird „Kein Mitglied“. Dazu geht keine Mail hinaus.");
});

test("Hinweis erst ab 500 Konten", () => {
  expect(listLimitHint(499)).toBe("");
  expect(listLimitHint(500)).toContain("höchstens 500 Konten");
});

test("Austritt in einem Satz", () => {
  const day = (value) => value.slice(0, 10);
  expect(exitLine(null, day)).toBe("");
  expect(exitLine({ declared_at: "2026-11-01T10:00:00+00:00" }, day)).toBe("Austritt erklärt am 2026-11-01.");
  expect(exitLine({ declared_at: "2026-11-01T10:00:00+00:00", wished_last_day: "2026-12-31" }, day)).toBe("Austritt erklärt am 2026-11-01, Wunschtermin 2026-12-31.");
});
