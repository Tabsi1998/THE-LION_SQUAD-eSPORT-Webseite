import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Teilnehmer und „Unbekannte Namen“ (#1743): Liste mit Mitglied / Gast / Extern / offen, Namen hinzufügen (einer je
// Zeile) und der Dialog mit Vorschlägen samt Begründung – je Zeile bestätigen, Gast oder Extern. Nachträglich
// bearbeiten (#1929): je Zeile „Bearbeiten“, Mehrfachauswahl mit Filter und Suche, „Als Gast“ / „Als Extern“,
// Zusammenführen und Entfernen. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const confirmMock = vi.fn();
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeriesParticipantsSection, countsText, splitNames, visibleParticipants } = await import("./SeriesParticipantsSection");
const { preselectedProfile, profileOptions } = await import("./UnknownNamesSheet");

const SERIES = { id: "serie-1", lineage: { id: "spur-1", title: "Probe Liga F1" } };
const PARTICIPANTS = {
  participants: [
    { id: "t1", name: "Anni Rennt", start_number: "17", link: "member", link_status: "decided", profile_id: "p-anna", profile_name: "Anna Probe", in_results: true },
    { id: "t2", name: "Gast Fahrer", default_team: "Probe Löwen", link: "guest", link_status: "decided", guest_name: "Gast Fahrer", in_results: true },
    { id: "t3", name: "Fremd Probe", default_team: "Fremd Rot", link: "external", link_status: "decided", in_results: false },
    { id: "t4", name: "Probe_Racer", link: "external", link_status: "open", in_results: false },
    { id: "t5", name: "Ganz Neu", start_number: "9", link: "external", link_status: "open", in_results: false },
  ],
  counts: { member: 1, guest: 1, external: 1, open: 2, club: 1 },
  profiles: [{ id: "p-anna", name: "Anna Probe" }, { id: "p-bert", name: "Bert Probe" }],
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
  apiMock.patch.mockReset();
  apiMock.delete.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/unknown-names") ? UNKNOWN : PARTICIPANTS }));
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockResolvedValue({ data: {} });
  apiMock.delete.mockResolvedValue({ data: {} });
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

test("Dialog: wartet eine andere Saison, steht der Hinweis des Servers dezent im Dialog", async () => {
  render(<SeriesParticipantsSection series={SERIES} />);
  fireEvent.click(await screen.findByTestId("series-unknown-open"));
  apiMock.post.mockResolvedValueOnce({ data: { other_series: { updated: [], pending: ["serie-2"] }, notice: "1 weitere Saison wird gerade bearbeitet und beim nächsten Speichern dort nachgezogen." } });
  fireEvent.click(await screen.findByTestId("unknown-t4-confirm"));
  expect(await screen.findByTestId("unknown-names-notice")).toHaveTextContent("1 weitere Saison wird gerade bearbeitet");
  // Ohne wartende Saison kommt kein Hinweis - der alte verschwindet.
  apiMock.post.mockResolvedValueOnce({ data: { other_series: { updated: ["serie-3"], pending: [] } } });
  await waitFor(() => expect(screen.getByTestId("unknown-t4-external")).not.toBeDisabled());
  fireEvent.click(screen.getByTestId("unknown-t4-external"));
  await waitFor(() => expect(screen.queryByTestId("unknown-names-notice")).toBeNull());
});

// ---------------------------------------------------------------- Nachträglich bearbeiten (#1929)
const URL = "/reference-series/admin/series/serie-1/participants";

async function rendered() {
  render(<SeriesParticipantsSection series={SERIES} />);
  await screen.findByTestId("participant-t1");
}

test("Hinweis erklärt Mitglied, Gast und Extern samt Alias", async () => {
  await rendered();
  const hint = screen.getByTestId("series-participants-hint");
  expect(hint).toHaveTextContent("Mitglied zählt für Verein und Profil.");
  expect(hint).toHaveTextContent("Gast fährt für ein Vereinsteam, ist aber kein Mitglied.");
  expect(hint).toHaveTextContent("Extern sind alle anderen.");
  expect(hint).toHaveTextContent("Mitglied und Gast gelten als Alias in allen Saisons, Extern nimmt den Alias zurück.");
});

test("Filter nach Zuordnung und Suche zeigen nur passende Teilnehmer", async () => {
  await rendered();
  fireEvent.click(screen.getByTestId("participants-filter-guest"));
  expect(screen.getByTestId("participants-filter-guest")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("participant-t2")).toBeInTheDocument();
  expect(screen.queryByTestId("participant-t1")).toBeNull();
  fireEvent.click(screen.getByTestId("participants-filter-open"));
  expect(screen.getByTestId("participant-t4")).toBeInTheDocument();
  expect(screen.queryByTestId("participant-t2")).toBeNull();
  fireEvent.change(screen.getByTestId("participants-search"), { target: { value: "NEU" } });
  expect(screen.getByTestId("participant-t5")).toBeInTheDocument();
  expect(screen.queryByTestId("participant-t4")).toBeNull();
  fireEvent.change(screen.getByTestId("participants-search"), { target: { value: "zzz" } });
  expect(screen.getByTestId("series-participants-none")).toHaveTextContent("Kein Teilnehmer passt");
});

test("Suche über Name, Startnummer, Team und Profil; offen zählt nicht als Extern", () => {
  const ids = (filter, query) => visibleParticipants(PARTICIPANTS.participants, filter, query).map((row) => row.id);
  expect(ids("all", "anna")).toEqual(["t1"]);
  expect(ids("all", "17")).toEqual(["t1"]);
  expect(ids("all", "fremd  rot")).toEqual(["t3"]);
  expect(ids("member", "")).toEqual(["t1"]);
  expect(ids("external", "")).toEqual(["t3"]);
  expect(ids("open", "")).toEqual(["t4", "t5"]);
});

test("Mehrfachauswahl: zwei wählen und als Extern markieren – ein Aufruf für alle", async () => {
  apiMock.post.mockResolvedValue({ data: { changed: ["t2"], unchanged: ["t3"], other_series: { updated: ["serie-0"], pending: [] } } });
  await rendered();
  expect(screen.queryByTestId("participants-bulk-external")).toBeNull();
  fireEvent.click(screen.getByTestId("participant-select-t2"));
  fireEvent.click(screen.getByTestId("participant-select-t3"));
  expect(screen.getByTestId("participants-bulk-count")).toHaveTextContent("2 ausgewählt");
  fireEvent.click(screen.getByTestId("participants-bulk-external"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${URL}/bulk-assign`, { participant_ids: ["t2", "t3"], link: "external" }));
  expect(confirmMock).not.toHaveBeenCalled();
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("1 als Extern markiert · 1 war es schon"));
  await waitFor(() => expect(screen.queryByTestId("participants-bulk-count")).toBeNull());
});

test("Alle auswählen nimmt nur die sichtbaren; ist ein Mitglied dabei, fragt die Seite nach", async () => {
  apiMock.post.mockResolvedValue({ data: { changed: ["t4", "t5"], unchanged: [], other_series: { updated: [], pending: ["serie-2"] }, notice: "1 weitere Saison wird gerade bearbeitet und beim nächsten Speichern dort nachgezogen." } });
  await rendered();
  fireEvent.click(screen.getByTestId("participants-select-all"));
  expect(screen.getByTestId("participants-bulk-count")).toHaveTextContent("5 ausgewählt");
  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("participants-bulk-guest"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(confirmMock.mock.calls[0][0].title).toBe("1 Mitglied als Gast?");
  expect(apiMock.post).not.toHaveBeenCalled();

  // Nach dem Filter zählen nur die sichtbaren.
  fireEvent.click(screen.getByTestId("participants-filter-open"));
  expect(screen.getByTestId("participants-bulk-count")).toHaveTextContent("2 ausgewählt");
  fireEvent.click(screen.getByTestId("participants-bulk-guest"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${URL}/bulk-assign`, { participant_ids: ["t4", "t5"], link: "guest" }));
  expect(await screen.findByTestId("series-participants-notice")).toHaveTextContent("1 weitere Saison wird gerade bearbeitet");
});

test("Bearbeiten: Name, Startnummer und Team schicken nur die Änderung", async () => {
  await rendered();
  fireEvent.click(screen.getByTestId("participant-edit-t3"));
  expect(screen.getByRole("dialog", { name: "Teilnehmer bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("participant-edit-name")).toHaveValue("Fremd Probe");
  fireEvent.change(screen.getByTestId("participant-edit-name"), { target: { value: "Fremd Probe Neu" } });
  fireEvent.change(screen.getByTestId("participant-edit-number"), { target: { value: "44" } });
  fireEvent.change(screen.getByTestId("participant-edit-team"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("participant-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`${URL}/t3`, { name: "Fremd Probe Neu", start_number: "44", default_team: null }));
  expect(apiMock.post).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByTestId("participant-edit")).toBeNull());
});

test("Bearbeiten: Zuordnung wechseln – Mitglied braucht ein Profil, Mitglied zu Extern fragt nach", async () => {
  await rendered();
  fireEvent.click(screen.getByTestId("participant-edit-t5"));
  expect(screen.getByTestId("participant-edit-link")).toHaveValue("");
  fireEvent.change(screen.getByTestId("participant-edit-link"), { target: { value: "member" } });
  fireEvent.click(screen.getByTestId("participant-edit-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Bitte ein Mitglied wählen."));
  fireEvent.change(screen.getByTestId("participant-edit-profile"), { target: { value: "p-bert" } });
  fireEvent.click(screen.getByTestId("participant-edit-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${URL}/t5/assign`, { link: "member", profile_id: "p-bert" }));
  expect(apiMock.patch).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByTestId("participant-edit")).toBeNull());

  apiMock.post.mockClear();
  fireEvent.click(screen.getByTestId("participant-edit-t1"));
  expect(screen.getByTestId("participant-edit-profile")).toHaveValue("p-anna");
  fireEvent.change(screen.getByTestId("participant-edit-link"), { target: { value: "external" } });
  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("participant-edit-save"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(confirmMock.mock.calls[0][0].title).toBe("Anni Rennt als Extern?");
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("participant-edit-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${URL}/t1/assign`, { link: "external" }));
});

test("Entfernen nur ohne Ergebnis, mit Rückfrage", async () => {
  await rendered();
  fireEvent.click(screen.getByTestId("participant-edit-t1"));
  expect(screen.getByTestId("participant-edit-in-results")).toHaveTextContent("Steht in Ergebnissen dieser Saison");
  expect(screen.queryByTestId("participant-edit-remove")).toBeNull();
  fireEvent.click(screen.getByTestId("participant-edit-cancel"));

  fireEvent.click(screen.getByTestId("participant-edit-t3"));
  fireEvent.click(screen.getByTestId("participant-edit-remove"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith(`${URL}/t3`));
  expect(confirmMock.mock.calls[0][0].title).toBe("Fremd Probe entfernen?");
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Fremd Probe entfernt."));
});

test("Zusammenführen: genau zwei gewählt, der gewählte bleibt, der andere geht in ihm auf", async () => {
  await rendered();
  fireEvent.click(screen.getByTestId("participant-select-t1"));
  expect(screen.queryByTestId("participants-bulk-merge")).toBeNull();
  fireEvent.click(screen.getByTestId("participant-select-t5"));
  fireEvent.click(screen.getByTestId("participants-bulk-merge"));
  expect(screen.getByRole("dialog", { name: "Zusammenführen" })).toBeInTheDocument();
  // Vorausgewählt bleibt der schon zugeordnete.
  expect(screen.getByTestId("participant-merge-keep-t1")).toBeChecked();
  fireEvent.click(screen.getByTestId("participant-merge-keep-t5"));
  fireEvent.click(screen.getByTestId("participant-merge-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${URL}/t5/merge`, { duplicate_id: "t1" }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Zusammengeführt: Ganz Neu bleibt."));
});

test("Zusammenführen: die Meldung des Servers bleibt sichtbar, nichts schließt sich", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "„Anni Rennt“ und „Ganz Neu“ stehen beide im Ergebnis von R2." } } });
  await rendered();
  fireEvent.click(screen.getByTestId("participant-select-t1"));
  fireEvent.click(screen.getByTestId("participant-select-t5"));
  fireEvent.click(screen.getByTestId("participants-bulk-merge"));
  fireEvent.click(screen.getByTestId("participant-merge-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("„Anni Rennt“ und „Ganz Neu“ stehen beide im Ergebnis von R2."));
  expect(screen.getByTestId("participant-merge")).toBeInTheDocument();
});
