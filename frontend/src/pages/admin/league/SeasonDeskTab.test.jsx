import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Reiter „Leitstand“ der Season (E.4, Nr. 152): Gruppen mit Zähler, Frist, Zuständigkeit und Weg, Filter „Nur meine“, Hinweis bei
// Befangenheit, leerer Zustand, Protokoll seitenweise, Rundnachricht nur mit Recht. Erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));

const { SeasonDeskTab, deskText } = await import("./SeasonDeskTab");

const item = (id, extra = {}) => ({
  id, kind: "overdue", title: "Staffel A · Spieltag 2", text: "Nie gemeldet, der Termin ist vorbei.", url: "/matches/m1", action: "Spiel öffnen",
  due_at: null, since: "2026-11-10T18:00:00+00:00", assignee: null, conflict: false, conflict_text: null, mine: true, ...extra,
});
const DESK = {
  season: { id: "s1", name: "Season 1" }, total: 3, mine: 2, can_broadcast: true,
  groups: [
    { key: "incidents", label: "Vorfälle", responsible: "„Ergebnisse korrigieren“ oder „Proteste“", items: [], failed: false },
    { key: "overdue", label: "Überfällige Spiele", responsible: "„Spiele betreuen“ oder „Ergebnisse korrigieren“", failed: false, items: [
      item("overdue:m1"),
      item("overdue:m2", { title: "Staffel A · Spieltag 3", mine: false, conflict: true,
        conflict_text: "Du bist an diesem Spiel selbst beteiligt. Das entscheidet eine zweite berechtigte Person." }),
    ] },
    { key: "procedures", label: "Verfahren", responsible: "„Proteste“", failed: false, items: [
      item("procedures:p1", { kind: "procedures", title: "Staffel A · Spieltag 1", text: "Protest übernommen, Zielfrist läuft.", url: "/matches/m3#verfahren-p1",
        action: "Zum Verfahren", due_at: "2099-01-01T12:00:00+00:00", assignee: { name: "Zweitleitung", own: false }, mine: true }),
    ] },
  ],
};
const LOG = { items: [{ id: "a1", action: "league.broadcast", label: "Rundnachricht", at: "2026-11-12T18:00:00+00:00", actor: "Leitung",
  broadcast: { audience: "Captains und Vertreter", scope: "Ganze Season", recipients: 12, mail: true }, staffel: null, match_id: null }],
page: 1, pages: 2, total: 26, page_size: 25 };

function renderTab(desk = DESK) {
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/desk") ? desk : LOG }));
  return render(<MemoryRouter><SeasonDeskTab seasonId="s1" divisions={[]} /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { recipients: 4, scope_label: "Ganze Season" } });
});

test("zeigt die Gruppen mit Zähler, Frist, Zuständigkeit und dem Weg zur Stelle", async () => {
  renderTab();
  const overdue = await screen.findByTestId("desk-group-overdue");
  expect(within(overdue).getByTestId("desk-group-count-overdue")).toHaveTextContent("2");
  expect(screen.getByTestId("desk-total")).toHaveTextContent("3");
  expect(screen.getByTestId("desk-item-open-overdue:m1")).toHaveAttribute("href", "/matches/m1");
  expect(screen.getByTestId("desk-item-when-overdue:m1")).toHaveTextContent(/^seit /);
  expect(screen.getByTestId("desk-item-when-procedures:p1")).toHaveTextContent(/^Frist noch/);
  expect(screen.getByTestId("desk-item-responsible-procedures:p1")).toHaveTextContent("Übernommen von Zweitleitung");
  expect(screen.getByTestId("desk-item-responsible-overdue:m1")).toHaveTextContent("„Spiele betreuen“");
  expect(screen.getByTestId("desk-item-conflict-overdue:m2")).toHaveTextContent("zweite berechtigte Person");
  // Gruppen ohne Aufgabe stehen nur als Zeile, nicht als leere Liste.
  expect(screen.queryByTestId("desk-group-incidents")).not.toBeInTheDocument();
  expect(screen.getByTestId("desk-quiet")).toHaveTextContent("Vorfälle");
  expect(screen.getByTestId("desk-summary")).toHaveTextContent("2 von 3 kannst du selbst erledigen");
});

test("„Nur meine“ blendet aus, was eine zweite Person entscheidet", async () => {
  renderTab();
  await screen.findByTestId("desk-item-overdue:m2");
  fireEvent.click(screen.getByTestId("desk-filter-mine"));
  expect(screen.getByTestId("desk-filter-mine")).toHaveAttribute("aria-checked", "true");
  expect(screen.queryByTestId("desk-item-overdue:m2")).not.toBeInTheDocument();
  expect(screen.getByTestId("desk-item-overdue:m1")).toBeInTheDocument();
  expect(screen.getByTestId("desk-total")).toHaveTextContent("2");
});

test("ohne offene Aufgabe: „Alles erledigt“ - auch unter „Nur meine“ mit Hinweis auf „Alle“", async () => {
  renderTab({ ...DESK, total: 0, mine: 0, groups: DESK.groups.map((group) => ({ ...group, items: [] })) });
  expect(await screen.findByTestId("desk-empty")).toHaveTextContent("Alles erledigt");
  expect(screen.getByTestId("desk-empty")).toHaveTextContent("keine Aufgabe auf die Liga-Leitung");
});

test("nur einzelne Zuständigkeiten: der leere Zustand spricht von deinen Zuständigkeiten", async () => {
  renderTab({ ...DESK, total: 0, mine: 0, limited: true, can_broadcast: false, groups: [{ ...DESK.groups[1], items: [] }] });
  expect(await screen.findByTestId("desk-empty")).toHaveTextContent("Für deine Zuständigkeiten wartet gerade nichts.");
});

test("„Nur meine“ ohne eigene Aufgabe verweist auf „Alle“", async () => {
  const groups = [{ ...DESK.groups[1], items: [DESK.groups[1].items[1]] }];
  renderTab({ ...DESK, total: 1, mine: 0, groups });
  await screen.findByTestId("desk-item-overdue:m2");
  fireEvent.click(screen.getByTestId("desk-filter-mine"));
  expect(screen.getByTestId("desk-empty")).toHaveTextContent("unter „Alle“");
});

test("Protokoll mit Absender, Kreis und Seiten", async () => {
  renderTab();
  const row = await screen.findByTestId("desk-log-a1");
  expect(row).toHaveTextContent("Rundnachricht");
  expect(row).toHaveTextContent("Captains und Vertreter, Ganze Season, 12 Empfänger, mit Mail");
  expect(row).toHaveTextContent("Leitung");
  expect(screen.getByTestId("desk-log-page")).toHaveTextContent("Seite 1 von 2");
  fireEvent.click(screen.getByTestId("desk-log-older"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/desk/log", { params: { page: 2 } }));
});

test("Rundnachricht nur mit Recht", async () => {
  renderTab({ ...DESK, can_broadcast: false });
  await screen.findByTestId("desk-group-overdue");
  expect(screen.queryByTestId("desk-broadcast-open")).not.toBeInTheDocument();
});

test("öffnet die Rundnachricht", async () => {
  renderTab();
  fireEvent.click(await screen.findByTestId("desk-broadcast-open"));
  expect(await screen.findByTestId("broadcast-sheet")).toBeInTheDocument();
});

test("Vorfälle und Regelwerk sagen es wie „Mein Dienst“", () => {
  expect(deskText({ kind: "incidents", detail: { code: "in_review", position: 2 } })).toContain("Map 2 ist in Klärung");
  expect(deskText({ kind: "rules", detail: { kind: "draft" } })).toContain("Entwurf wartet");
  expect(deskText({ kind: "overdue", text: "Satz" })).toBe("Satz");
});
