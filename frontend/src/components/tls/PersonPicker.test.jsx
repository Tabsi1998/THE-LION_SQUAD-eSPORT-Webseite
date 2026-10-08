import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

// Personensuche (#1354): tippen, Treffer mit Bild und Zusammenhang, zuletzt Gewählte oben, Fehler als Satz -
// ohne E-Mail-Adressen und ohne die ganze Kontoliste.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback,
  resolveMediaUrl: (value) => value || "",
}));

const { PersonPicker, readRecent } = await import("./PersonPicker");

const HITS = [
  { id: "u1", name: "Erika Beispiel", avatar_url: "/api/static/uploads/erika.webp", context: "Mitglied · Team Lions Rocket", is_club_member: true },
  { id: "u2", name: "Max Muster", avatar_url: null, context: "angemeldet" },
];

function Harness({ onPick = () => {} }) {
  const [person, setPerson] = useState(null);
  return <PersonPicker purpose="tournament" contextId="t-1" value={person} onChange={(next) => { setPerson(next); onPick(next); }} label="Teilnehmer" testId="picker" />;
}

beforeEach(() => {
  apiMock.get.mockReset();
  window.localStorage.clear();
});

async function type(value) {
  fireEvent.change(screen.getByTestId("picker-search"), { target: { value } });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
}

test("tippen sucht nach dem Namen für genau diesen Zweck und zeigt Name, Bild und Zusammenhang", async () => {
  apiMock.get.mockResolvedValue({ data: HITS });
  render(<Harness />);
  await type("eri");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/people/search", expect.objectContaining({ params: { purpose: "tournament", q: "eri", context_id: "t-1" } })));
  expect(await screen.findByTestId("picker-option-u1")).toHaveTextContent("Erika Beispiel");
  expect(screen.getByTestId("picker-option-u1")).toHaveTextContent("Mitglied · Team Lions Rocket");
  expect(screen.getByTestId("picker-option-u2")).toHaveTextContent("angemeldet");
  expect(screen.getByTestId("picker-list")).not.toHaveTextContent("@");
});

test("wählen zeigt die Person, merkt sie als zuletzt gewählt und lässt sich wieder lösen", async () => {
  apiMock.get.mockResolvedValue({ data: HITS });
  const onPick = vi.fn();
  render(<Harness onPick={onPick} />);
  await type("max");
  fireEvent.click(await screen.findByTestId("picker-option-u2"));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "u2", name: "Max Muster" }));
  expect(screen.getByTestId("picker-selected")).toHaveTextContent("Max Muster");
  expect(readRecent("tournament").map((row) => row.id)).toEqual(["u2"]);
  expect(readRecent("tournament")[0]).not.toHaveProperty("email");

  fireEvent.click(screen.getByTestId("picker-clear"));
  expect(onPick).toHaveBeenLastCalledWith(null);
  // Leeres Feld: oben stehen die zuletzt Gewählten - ohne neue Anfrage.
  apiMock.get.mockClear();
  fireEvent.focus(screen.getByTestId("picker-search"));
  expect(await screen.findByText("Zuletzt gewählt")).toBeInTheDocument();
  expect(screen.getByTestId("picker-option-u2")).toHaveTextContent("Max Muster");
  expect(apiMock.get).not.toHaveBeenCalled();
});

test("fehlt das Recht, steht ein Satz statt einer leeren Liste", async () => {
  apiMock.get.mockRejectedValue({ response: { status: 403, data: { detail: "Dafür fehlt dir das Recht: Teilnehmer und Helfer eines Turniers." } } });
  render(<Harness />);
  await type("eri");
  expect(await screen.findByTestId("picker-error")).toHaveTextContent("Dafür fehlt dir das Recht: Teilnehmer und Helfer eines Turniers.");
  expect(screen.queryByTestId("picker-list")).toBeNull();
});

test("ohne Treffer sagt die Liste das", async () => {
  apiMock.get.mockResolvedValue({ data: [] });
  render(<Harness />);
  await type("zzz");
  expect(await screen.findByTestId("picker-empty")).toHaveTextContent("Niemand mit diesem Namen.");
});
