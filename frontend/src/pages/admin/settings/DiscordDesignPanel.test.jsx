import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Gestaltung (#866): Meldungsarten wählen, als Formular oder JSON bearbeiten, Platzhalter einfügen, Vorschau vom
// Server, speichern, Standard wiederherstellen, Testnachricht - und kaputtes JSON blockiert das Speichern.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DiscordDesignPanel, setPath, getPath } = await import("./DiscordDesignPanel");

const STREAM = {
  key: "stream_live", label: "Stream gestartet", group: "Streams", hint: "Je Stream eine Meldung.", list: false, customized: false, changed: null,
  placeholders: [{ name: "streamer", text: "Name", kind: "text", sample: "Paula", row: false }, { name: "title", text: "Titel", kind: "text", sample: "Finale", row: false }],
  template: { content: "🔴 **{streamer}** ist live", color: "#9146FF", title: "{title}", fields: [{ name: "Spiel", value: "{game}", inline: true }] },
  default: { title: "{title}" },
  preview: { content: "🔴 **Paula** ist live", embed: { title: "Finale", color: 0x9146ff } },
};
const RANKING = {
  key: "ranking", label: "Rangliste", group: "Angeheftete Einbettungen", hint: "Top 10.", list: true, customized: true, changed: { at: "2026-10-03T10:00:00+00:00" },
  placeholders: [{ name: "season", text: "Saison", kind: "text", sample: "2026", row: false }, { name: "name", text: "Name", kind: "text", sample: "Paula", row: true }],
  template: { title: "🏆 {season}", description: "{rows}", rows: "lines", row: "{name}" }, default: {},
  preview: { content: null, embed: { title: "🏆 2026", description: "Paula" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  apiMock.get.mockResolvedValue({ data: { kinds: [STREAM, RANKING], groups: ["Streams", "Angeheftete Einbettungen"], limits: { total: 6000 } } });
  apiMock.post.mockImplementation(async (url, body) => (url.endsWith("/preview")
    ? { data: { content: body.template.content || null, embed: { title: String(body.template.title || "").replace("{title}", "Finale"), color: 0x9146ff }, errors: [], data: body.data, length: 6 } }
    : { data: { ok: true } }));
  apiMock.put.mockImplementation(async (url, body) => ({ data: { ...STREAM, template: body.template, customized: true } }));
  apiMock.delete.mockResolvedValue({ data: { ...RANKING, customized: false } });
});

test("Pfade setzen ohne das Original zu ändern; leere Teile fallen weg", () => {
  const original = { author: { name: "x" }, fields: [{ name: "a" }] };
  const next = setPath(original, "fields.0.value", "b");
  expect(next.fields[0]).toEqual({ name: "a", value: "b" }) ;
  expect(original.fields[0]).toEqual({ name: "a" });
  expect(setPath(original, "author.name", "")).not.toHaveProperty("author");
  expect(getPath(next, "fields.0.value")).toBe("b");
});

test("Titel ändern zeigt die Vorschau vom Server, Speichern schickt den Entwurf", async () => {
  render(<DiscordDesignPanel />);
  const title = await screen.findByTestId("discord-design-field-title");
  expect(screen.getByTestId("discord-design-message-content")).toHaveTextContent("Paula ist live");
  expect(screen.getByTestId("discord-design-save")).toBeDisabled();
  fireEvent.change(title, { target: { value: "🎮 {title}" } });
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/design/stream_live/preview", expect.objectContaining({ template: expect.objectContaining({ title: "🎮 {title}" }), data: "sample" })));
  expect(await screen.findByText("🎮 Finale")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("discord-design-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/discord/design/stream_live", { template: expect.objectContaining({ title: "🎮 {title}" }) }));
  expect(toastMock.success).toHaveBeenCalledWith("Gestaltung gespeichert – sie gilt ab der nächsten Meldung.");

  // Echte Daten in der Vorschau, Testnachricht mit dem Entwurf.
  fireEvent.click(screen.getByTestId("discord-design-data-live"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/design/stream_live/preview", expect.objectContaining({ data: "live" })));
  fireEvent.click(screen.getByTestId("discord-design-test"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/discord/design/stream_live/test", { template: expect.objectContaining({ title: "🎮 {title}" }) }));
});

test("Platzhalter landen im zuletzt gewählten Feld; Felder lassen sich anlegen und entfernen", async () => {
  render(<DiscordDesignPanel />);
  const description = await screen.findByTestId("discord-design-field-description");
  fireEvent.focus(description);
  fireEvent.click(screen.getByTestId("discord-design-placeholder-streamer"));
  expect(description).toHaveValue("{streamer}");
  fireEvent.click(screen.getByTestId("discord-design-field-add"));
  expect(screen.getByTestId("discord-design-field-fields.1.name")).toHaveValue("");
  fireEvent.click(screen.getByTestId("discord-design-field-remove-0"));
  expect(screen.getByTestId("discord-design-field-fields.0.name")).toHaveValue("");
});

test("kaputtes JSON blockiert das Speichern und steht als Fehler da; Listen zeigen die Einträge, Zurücksetzen fragt nach", async () => {
  render(<DiscordDesignPanel />);
  await screen.findByTestId("discord-design-field-title");
  fireEvent.click(screen.getByTestId("discord-design-mode-json"));
  fireEvent.change(screen.getByTestId("discord-design-json"), { target: { value: "{ kaputt" } });
  expect(screen.getByTestId("discord-design-save")).toBeDisabled();
  expect(screen.getByTestId("discord-design-errors")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("discord-design-json"), { target: { value: JSON.stringify({ title: "{title}", color: "#00FF88" }) } });
  expect(screen.getByTestId("discord-design-save")).toBeEnabled();

  fireEvent.click(screen.getByTestId("discord-design-kind-ranking"));
  expect(window.confirm).toHaveBeenCalledWith("Ungespeicherte Änderungen verwerfen?");
  fireEvent.click(screen.getByTestId("discord-design-mode-form"));
  expect(await screen.findByTestId("discord-design-rows")).toBeInTheDocument();
  expect(screen.getByTestId("discord-design-field-row")).toHaveValue("{name}");
  expect(screen.getByTestId("discord-design-placeholder-name")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("discord-design-reset"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/settings/discord/design/ranking"));
  expect(toastMock.success).toHaveBeenCalledWith("Standard wiederhergestellt.");
});
