import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Teilnehmer und „Unbekannte Namen“ (#1743): Liste mit Mitglied / Gast / Extern / offen, Namen hinzufügen (einer je
// Zeile) und der Dialog mit Vorschlägen samt Begründung – je Zeile bestätigen, Gast oder Extern. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeriesParticipantsSection, countsText, splitNames } = await import("./SeriesParticipantsSection");
const { preselectedProfile, profileOptions } = await import("./UnknownNamesSheet");

const SERIES = { id: "serie-1", lineage: { id: "spur-1", title: "Probe Liga F1" } };
const PARTICIPANTS = {
  participants: [
    { id: "t1", name: "Anni Rennt", start_number: "17", link: "member", link_status: "decided", profile_id: "p-anna", profile_name: "Anna Probe" },
    { id: "t2", name: "Gast Fahrer", link: "guest", link_status: "decided", guest_name: "Gast Fahrer" },
    { id: "t3", name: "Fremd Probe", link: "external", link_status: "decided" },
    { id: "t4", name: "Probe_Racer", link: "external", link_status: "open" },
    { id: "t5", name: "Ganz Neu", start_number: "9", link: "external", link_status: "open" },
  ],
  counts: { member: 1, guest: 1, external: 1, open: 2, club: 1 },
};
const UNKNOWN = {
  items: [
    { participant: PARTICIPANTS.participants[3], suggestions: [
      { target: "member", profile_id: "p-anna", label: "Anna Probe", basis: "game_id", strong: true, reason: "Spiel-ID passt (EA-ID)" },
    ] },
    { participant: PARTICIPANTS.participants[4], suggestions: [
      { target: "member", profile_id: "p-bert", label: "Bert Probe", basis: "start_number", strong: false, reason: "Gleiche Startnummer 9 wie in 2025" },
    ] },
  ],
  profiles: [{ id: "p-anna", name: "Anna Probe" }, { id: "p-bert", name: "Bert Probe" }, { id: "p-cora", name: "Cora Probe" }],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/unknown-names") ? UNKNOWN : PARTICIPANTS }));
  apiMock.post.mockResolvedValue({ data: {} });
});

test("Liste zeigt je Name Mitglied, Gast, Extern oder offen samt Zählung", async () => {
  render(<SeriesParticipantsSection series={SERIES} />);
  expect(await screen.findByTestId("participant-link-t1")).toHaveTextContent("Mitglied · Anna Probe");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/participants");
  expect(screen.getByTestId("participant-link-t2")).toHaveTextContent("Gast");
  expect(screen.getByTestId("participant-link-t3")).toHaveTextContent("Extern");
  expect(screen.getByTestId("participant-link-t4")).toHaveTextContent("Offen");
  expect(screen.getByTestId("series-participants-counts")).toHaveTextContent("1 Mitglied · 1 Gast · 1 Extern · 2 offen");
  expect(screen.getByTestId("series-unknown-open")).toHaveTextContent("Unbekannte Namen (2)");
});

test("Dialog: Vorschlag mit Begründung, stark vorausgewählt, Startnummer nur als Hinweis", async () => {
  render(<SeriesParticipantsSection series={SERIES} />);
  fireEvent.click(await screen.findByTestId("series-unknown-open"));
  expect(await screen.findByRole("dialog", { name: "Unbekannte Namen" })).toBeInTheDocument();
  const first = await screen.findByTestId("unknown-t4");
  expect(within(first).getByTestId("unknown-t4-suggestions")).toHaveTextContent("Anna Probe · Spiel-ID passt (EA-ID)");
  expect(within(first).getByTestId("unknown-t4-profile")).toHaveValue("p-anna");
  const second = screen.getByTestId("unknown-t5");
  expect(within(second).getByTestId("unknown-t5-suggestions")).toHaveTextContent("Gleiche Startnummer 9 wie in 2025");
  expect(within(second).getByTestId("unknown-t5-profile")).toHaveValue("");
  expect(within(second).getByTestId("unknown-t5-confirm")).toBeDisabled();
});

test("Dialog: bestätigen, Gast und Extern schicken je eine Zuordnung", async () => {
  render(<SeriesParticipantsSection series={SERIES} />);
  fireEvent.click(await screen.findByTestId("series-unknown-open"));
  fireEvent.click(await screen.findByTestId("unknown-t4-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    "/reference-series/admin/series/serie-1/participants/t4/assign", { link: "member", profile_id: "p-anna" }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Zugeordnet."));

  fireEvent.change(screen.getByTestId("unknown-t5-profile"), { target: { value: "p-cora" } });
  fireEvent.click(screen.getByTestId("unknown-t5-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    "/reference-series/admin/series/serie-1/participants/t5/assign", { link: "member", profile_id: "p-cora" }));

  await waitFor(() => expect(screen.getByTestId("unknown-t5-guest")).not.toBeDisabled());
  fireEvent.click(screen.getByTestId("unknown-t5-guest"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    "/reference-series/admin/series/serie-1/participants/t5/assign", { link: "guest", guest_name: "Ganz Neu" }));
  await waitFor(() => expect(screen.getByTestId("unknown-t4-external")).not.toBeDisabled());
  fireEvent.click(screen.getByTestId("unknown-t4-external"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    "/reference-series/admin/series/serie-1/participants/t4/assign", { link: "external" }));
});

test("Dialog ohne offene Namen sagt es klar", async () => {
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/unknown-names") ? { items: [], profiles: [] } : PARTICIPANTS }));
  render(<SeriesParticipantsSection series={SERIES} />);
  fireEvent.click(await screen.findByTestId("series-unknown-open"));
  expect(await screen.findByTestId("unknown-names-empty")).toHaveTextContent("Alle Namen sind zugeordnet.");
});

test("Namen hinzufügen: einer je Zeile, leere Zeilen fallen weg", async () => {
  apiMock.post.mockResolvedValue({ data: { created: [{ id: "n1", link_status: "open" }, { id: "n2", link_status: "decided" }], skipped: 1 } });
  render(<SeriesParticipantsSection series={SERIES} />);
  fireEvent.click(await screen.findByTestId("series-participants-add"));
  fireEvent.change(screen.getByTestId("participants-add-names"), { target: { value: "Erste Probe\n\n  Zweite Probe \nAnni Rennt" } });
  fireEvent.click(screen.getByTestId("participants-add-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    "/reference-series/admin/series/serie-1/participants/batch", { names: ["Erste Probe", "Zweite Probe", "Anni Rennt"] }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("2 hinzugefügt · 1 schon erkannt · 1 übersprungen"));
});

test("Hilfen: Zeilen trennen, Vorauswahl nur bei starkem Vorschlag, Vorschläge zuerst", () => {
  expect(splitNames("a\r\n b \n\n")).toEqual(["a", "b"]);
  expect(preselectedProfile([{ target: "member", profile_id: "p1", strong: false }])).toBe("");
  expect(preselectedProfile([{ target: "guest", strong: true }, { target: "member", profile_id: "p2", strong: true }])).toBe("p2");
  expect(profileOptions([{ target: "member", profile_id: "p2", label: "Bert" }], [{ id: "p1", name: "Anna" }, { id: "p2", name: "Bert" }]))
    .toEqual([["", "Mitglied wählen …"], ["p2", "Bert – Vorschlag"], ["p1", "Anna"]]);
});

test("Zählung in Einzahl und Mehrzahl", () => {
  expect(countsText({ member: 1, guest: 1, external: 1, open: 1 })).toBe("1 Mitglied · 1 Gast · 1 Extern · 1 offen");
  expect(countsText({ member: 2, guest: 2, external: 0, open: 3 })).toBe("2 Mitglieder · 2 Gäste · 0 Extern · 3 offen");
  expect(countsText({})).toBe("0 Mitglieder · 0 Gäste · 0 Extern · 0 offen");
});
