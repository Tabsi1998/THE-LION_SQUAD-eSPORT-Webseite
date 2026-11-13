import { checkinMatches } from "./tournamentCheckin";

// Suche im Check-in-Reiter (#1161): Groß/klein, Akzente und ß/ss egal - auch in den Namen der Mitglieder.
const row = (name, members = []) => ({ id: name, name, members });

test("ß und ss finden einander", () => {
  expect(checkinMatches(row("Jonas Weißensteiner"), "weissen")).toBe(true);
  expect(checkinMatches(row("Jonas Weissensteiner"), "weißen")).toBe(true);
  expect(checkinMatches(row("GROSSE LÖWEN"), "große löwen")).toBe(true);
  expect(checkinMatches(row("Team", [{ id: "a", name: "Strauß Maximilian" }]), "strauss")).toBe(true);
  expect(checkinMatches(row("Jonas"), "weiss")).toBe(false);
});

test("Akzente und mehrere Wörter", () => {
  expect(checkinMatches(row("Zoë Ångström"), "zoe angst")).toBe(true);
  expect(checkinMatches(row("Zoë Ångström"), "zoe berta")).toBe(false);
  expect(checkinMatches(row("Zoë Ångström"), "   ")).toBe(true);
});
