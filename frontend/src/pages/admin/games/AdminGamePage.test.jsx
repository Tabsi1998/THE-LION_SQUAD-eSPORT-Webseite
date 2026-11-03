import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Spielseite (#2249): ein Spiel an einem Ort, in Reitern Allgemein, Spiel-IDs, Modi und Maps. Reiter per Adresse, Speichern
// je Reiter mit genau dessen Feldern, Entwürfe überleben den Reiterwechsel, Verlassen mit Ungespeichertem fragt nach.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({
  api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), formatRequestError: (_err, fallback) => fallback, resolveMediaUrl: (url) => url || "",
}));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: ({ testId }) => <div data-testid={testId} /> }));
const confirmMock = vi.fn(async () => true);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminGamePage } = await import("./AdminGamePage");

const GAME = { id: "g1", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8", kind: "standalone", player_id_fields: [], match_modes: [] };
const SERVERS = [
  { guild_id: "1", name: "LION", role: "main", enabled: true, left: false },
  { guild_id: "2", name: "Rocket League", role: "sub", enabled: true, left: false },
  { guild_id: "3", name: "Alt", role: "sub", enabled: false, left: false },
  { guild_id: "4", name: "Weg", role: "sub", enabled: false, left: true },
];
const MAPS = { game: { id: "g1", name: "Mario Kart 8 Deluxe", slug: "mario-kart-8", modes: [] }, maps: [], limit: 200, default_pool: null };

let game;
let servers;
let usage;
function serve() {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/games/discord-servers") return { data: servers };
    if (url === "/games") return { data: [game, { id: "p1", name: "Call of Duty", slug: "cod", kind: "series" }] };
    if (url === "/games/g1/usage") return { data: usage };
    if (url === "/games/g1/maps") return { data: MAPS };
    if (url === "/games/g1" || url === "/games/mario-kart-8") return { data: game };
    throw Object.assign(new Error("nicht da"), { response: { status: 404 } });
  });
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  game = { ...GAME };
  servers = [];
  usage = { modes: {} };
  serve();
  apiMock.patch.mockImplementation(async () => ({ data: game }));
});

let lastLocation = null;
function LocationProbe() {
  lastLocation = useLocation();
  return null;
}

function renderPage(entry = "/admin/games/g1") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/games/:gameId" element={<><AdminGamePage /><LocationProbe /></>} />
        <Route path="/admin/games" element={<div data-testid="games-list">Liste</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Reiter", () => {
  test("Allgemein ist der erste Reiter; #modi und #maps öffnen ihren Reiter direkt", async () => {
    const { unmount } = renderPage();
    expect(await screen.findByTestId("game-page-title")).toHaveTextContent("Mario Kart 8 Deluxe");
    expect(screen.getByTestId("game-tab-allgemein")).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Allgemein", "Spiel-IDs", "Modi", "Maps"]);
    expect(screen.getByTestId("game-edit-name")).toHaveValue("Mario Kart 8 Deluxe");
    unmount();

    const second = renderPage("/admin/games/g1#modi");
    expect(await screen.findByTestId("game-tab-modi")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("game-edit-modes-empty")).toBeInTheDocument();
    second.unmount();

    renderPage("/admin/games/mario-kart-8#maps");
    expect(await screen.findByTestId("game-maps-empty")).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith("/games/mario-kart-8");
    expect(apiMock.get).toHaveBeenCalledWith("/games/g1/maps");
  });

  test("ein Klick und die Pfeiltasten wechseln den Reiter und schreiben ihn in die Adresse", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("game-tab-ids"));
    expect(lastLocation.hash).toBe("#ids");
    expect(screen.getByTestId("game-ids-empty")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("game-tab-ids"), { key: "ArrowRight" });
    expect(lastLocation.hash).toBe("#modi");
    fireEvent.keyDown(screen.getByTestId("game-tab-modi"), { key: "Home" });
    expect(lastLocation.hash).toBe("");
    expect(screen.getByTestId("game-tab-allgemein")).toHaveAttribute("aria-selected", "true");
  });

  test("ein unbekanntes Spiel sagt das, statt leer zu bleiben", async () => {
    renderPage("/admin/games/gibts-nicht");
    expect(await screen.findByTestId("game-page-missing")).toHaveTextContent("gibt es nicht");
  });
});

describe("Allgemein", () => {
  test("Speichern schickt nur die eigenen Felder - keine Modi, keine IDs", async () => {
    renderPage();
    fireEvent.change(await screen.findByTestId("game-edit-short"), { target: { value: "MK8DX" } });
    expect(screen.getByTestId("game-unsaved")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("game-save-allgemein"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
    const [url, body] = apiMock.patch.mock.calls[0];
    expect(url).toBe("/games/g1");
    expect(body).toMatchObject({ name: "Mario Kart 8 Deluxe", slug: "mario-kart-8", short_name: "MK8DX", kind: "standalone" });
    for (const key of ["match_modes", "player_id_fields", "points_table", "genre", "platforms", "supports_solo"]) expect(body).not.toHaveProperty(key);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Allgemein gespeichert."));
  });

  test("ohne Namen wird nicht gespeichert", async () => {
    renderPage();
    fireEvent.change(await screen.findByTestId("game-edit-name"), { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("game-save-allgemein"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Bitte einen Namen eintragen."));
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  test("Discord-Server (#626): Auswahl aus dem Verzeichnis, ausgeschaltete gekennzeichnet, leer heißt erben", async () => {
    servers = SERVERS;
    game = { ...GAME, discord_guild_id: "3" };
    renderPage();
    const select = await screen.findByTestId("game-edit-discord");
    expect(select).toHaveValue("3");
    expect(screen.getByTestId("game-edit-discord-off")).toHaveTextContent("ausgeschaltet – bis dahin gilt: Hauptserver: LION");
    expect([...select.options].map((option) => option.value)).toEqual(["", "1", "2", "3"]);
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("game-save-allgemein"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ discord_guild_id: null })));
  });

  test("Discord-Rolle (#629): leer heißt „<Kurzname>-Spieler“, eine Spielversion hat keine eigene", async () => {
    renderPage();
    const role = await screen.findByTestId("game-edit-role");
    expect(role).toHaveAttribute("placeholder", "Mario Kart 8 Deluxe-Spieler");
    fireEvent.change(role, { target: { value: "  MK-Crew " } });
    fireEvent.click(screen.getByTestId("game-save-allgemein"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ discord_role_name: "MK-Crew" })));
    fireEvent.change(screen.getByTestId("game-edit-kind"), { target: { value: "edition" } });
    expect(screen.queryByTestId("game-edit-role")).toBeNull();
    expect(screen.getByTestId("game-edit-parent")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("game-edit-parent"), { target: { value: "p1" } });
    expect(screen.getByTestId("game-edition-preview")).toHaveTextContent("Call of Duty");
  });

  test("Verwerfen holt den gespeicherten Stand zurück", async () => {
    renderPage();
    fireEvent.change(await screen.findByTestId("game-edit-name"), { target: { value: "Anders" } });
    fireEvent.click(screen.getByTestId("admin-form-cancel"));
    expect(screen.getByTestId("game-edit-name")).toHaveValue("Mario Kart 8 Deluxe");
    expect(screen.getByTestId("game-saved-state")).toBeInTheDocument();
  });
});

describe("ungespeicherte Änderungen", () => {
  test("bleiben beim Reiterwechsel erhalten, der Reiter trägt einen Punkt", async () => {
    renderPage();
    fireEvent.change(await screen.findByTestId("game-edit-name"), { target: { value: "Mario Kart Welt" } });
    expect(screen.getByTestId("game-tab-dirty-allgemein")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("game-tab-modi"));
    expect(screen.queryByTestId("game-edit-name")).toBeNull();
    fireEvent.click(screen.getByTestId("game-tab-allgemein"));
    expect(screen.getByTestId("game-edit-name")).toHaveValue("Mario Kart Welt");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  test("die Seite verlassen fragt nach; wer bleibt, behält den Entwurf", async () => {
    confirmMock.mockResolvedValue(false);
    renderPage();
    fireEvent.change(await screen.findByTestId("game-edit-name"), { target: { value: "Mario Kart Welt" } });
    fireEvent.click(screen.getByTestId("game-page-back"));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Nicht gespeicherte Änderungen", description: expect.stringContaining("Allgemein"),
    })));
    expect(screen.queryByTestId("games-list")).toBeNull();
    expect(screen.getByTestId("game-edit-name")).toHaveValue("Mario Kart Welt");
    confirmMock.mockResolvedValue(true);
    fireEvent.click(screen.getByTestId("game-page-back"));
    expect(await screen.findByTestId("games-list")).toBeInTheDocument();
  });

  test("ohne Änderungen geht es ohne Frage zurück zur Liste", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("game-page-back"));
    expect(await screen.findByTestId("games-list")).toBeInTheDocument();
    expect(confirmMock).not.toHaveBeenCalled();
  });
});

describe("Spiel-IDs", () => {
  test("ein ID-Feld anlegen: der Schlüssel folgt der Bezeichnung, Speichern schickt nur die IDs", async () => {
    renderPage("/admin/games/g1#ids");
    fireEvent.click(await screen.findByTestId("game-id-field-add"));
    fireEvent.change(screen.getByTestId("game-id-field-label-0"), { target: { value: "A" } });
    fireEvent.change(screen.getByTestId("game-id-field-label-0"), { target: { value: "Activision ID" } });
    expect(screen.getByTestId("game-id-field-key-0")).toHaveValue("activision_id");
    fireEvent.change(screen.getByTestId("game-id-field-options-0"), { target: { value: "PC, PS5" } });
    fireEvent.click(screen.getByTestId("game-save-ids"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", {
      player_id_fields: [{ key: "activision_id", label: "Activision ID", help_text: "", required: true, options: ["PC", "PS5"] }],
    }));
  });

  test("ein gespeichertes Feld behält seinen Schlüssel, auch wenn die Bezeichnung sich ändert", async () => {
    game = { ...GAME, player_id_fields: [{ key: "epic", label: "Epic", required: true }] };
    renderPage("/admin/games/g1#ids");
    fireEvent.change(await screen.findByTestId("game-id-field-label-0"), { target: { value: "Epic Games ID" } });
    expect(screen.getByTestId("game-id-field-key-0")).toHaveValue("epic");
  });

  // Codex-Prüfung, Fund 3: „PSN-ID“ und „PSN ID“ ergeben denselben Schlüssel - die Seite sagt es, statt eines zu verwerfen.
  test("zwei neue Felder mit gleichem Schlüssel: Hinweis, nichts geht an den Server; ein eigener Schlüssel löst es", async () => {
    renderPage("/admin/games/g1#ids");
    fireEvent.click(await screen.findByTestId("game-id-field-add"));
    fireEvent.change(screen.getByTestId("game-id-field-label-0"), { target: { value: "PSN-ID" } });
    fireEvent.click(screen.getByTestId("game-id-field-add"));
    fireEvent.change(screen.getByTestId("game-id-field-label-1"), { target: { value: "PSN ID" } });
    fireEvent.click(screen.getByTestId("game-save-ids"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("„psn_id“ steht schon bei „PSN-ID“")));
    expect(apiMock.patch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("game-id-field-key-1"), { target: { value: "psn konto" } });
    fireEvent.change(screen.getByTestId("game-id-field-label-1"), { target: { value: "PSN Konto" } });
    expect(screen.getByTestId("game-id-field-key-1")).toHaveValue("psn_konto");
    fireEvent.click(screen.getByTestId("game-save-ids"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", { player_id_fields: [
      { key: "psn_id", label: "PSN-ID", help_text: "", required: true },
      { key: "psn_konto", label: "PSN Konto", help_text: "", required: true },
    ] }));
  });

  // Codex-Prüfung, Fund 1: Unter „PSN-ID“ stehen die IDs der Spieler - Speichern darf daraus nie „psn_id“ machen.
  test("ein nicht kanonischer Altschlüssel geht unverändert zurück und lässt sich nicht verstellen", async () => {
    game = { ...GAME, player_id_fields: [{ key: "PSN-ID", label: "PSN-ID", required: true }] };
    renderPage("/admin/games/g1#ids");
    expect(await screen.findByTestId("game-id-field-key-0")).toBeDisabled();
    fireEvent.change(screen.getByTestId("game-id-field-label-0"), { target: { value: "PlayStation-Konto" } });
    fireEvent.click(screen.getByTestId("game-save-ids"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", {
      player_id_fields: [{ key: "PSN-ID", label: "PlayStation-Konto", help_text: "", required: true }],
    }));
  });

  test("Spielversion: ID-Quelle und Erben stehen hier und gehen mit", async () => {
    game = { ...GAME, kind: "edition", parent_game_id: "p1", inherit_player_ids: true };
    renderPage("/admin/games/g1#ids");
    fireEvent.change(await screen.findByTestId("game-edit-identity-source"), { target: { value: "p1" } });
    fireEvent.click(screen.getByTestId("game-edit-inherit-ids"));
    fireEvent.click(screen.getByTestId("game-save-ids"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", { player_id_fields: [], identity_source_game_id: "p1", inherit_player_ids: false }));
  });
});

describe("Modi", () => {
  test("Modi, Laufgröße, Geräte, Aufbauzeit, Punkte und Best-of gehen mit „Modi speichern“", async () => {
    renderPage("/admin/games/g1#modi");
    fireEvent.click(await screen.findByTestId("game-edit-mode-add"));
    fireEvent.change(screen.getByTestId("game-edit-mode-label-0"), { target: { value: "Grand Prix 4 Rennen" } });
    fireEvent.change(screen.getByTestId("game-edit-mode-minutes-0"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("game-edit-mode-add"));
    fireEvent.change(screen.getByTestId("game-edit-mode-label-1"), { target: { value: "Einzelrennen" } });
    fireEvent.change(screen.getByTestId("game-edit-mode-minutes-1"), { target: { value: "4" } });
    fireEvent.click(screen.getByTestId("game-edit-mode-per-game-1"));
    fireEvent.change(screen.getByTestId("game-edit-run-local"), { target: { value: "4" } });
    fireEvent.change(screen.getByTestId("game-edit-run-online"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("game-edit-device-switch"));
    fireEvent.change(screen.getByTestId("game-edit-setup"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("game-edit-points"), { target: { value: "15-12-10-9" } });
    fireEvent.change(screen.getByTestId("game-edit-best-of"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("game-save-modi"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", {
      match_modes: [
        { label: "Grand Prix 4 Rennen", minutes: 12, per_game: false },
        { label: "Einzelrennen", minutes: 4, per_game: true },
      ],
      players_per_run_local: 4, players_per_run_online: 12, station_devices: ["switch"], setup_minutes: 3,
      points_table: [15, 12, 10, 9], default_best_of: 3,
    }));
  });

  test("eine kaputte Punktetabelle wird genannt und nicht gespeichert", async () => {
    renderPage("/admin/games/g1#modi");
    fireEvent.change(await screen.findByTestId("game-edit-points"), { target: { value: "15, zwölf" } });
    expect(screen.getByTestId("game-edit-points-error")).toHaveTextContent("„zwölf“ ist keine ganze Zahl.");
    fireEvent.click(screen.getByTestId("game-save-modi"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  describe("einen Modus entfernen (#2129, SP2)", () => {
    beforeEach(() => {
      game = { ...GAME, match_modes: [{ mode: "gp4", label: "Grand Prix", minutes: 12 }] };
    });

    async function removeAndSave() {
      renderPage("/admin/games/g1#modi");
      expect(await screen.findByTestId("game-edit-mode-name-0")).toHaveTextContent("Grand Prix");
      // #2206: Erst nach der Zählung steht fest, ob der Modus entfernt werden darf.
      await waitFor(() => expect(screen.getByTestId("game-edit-mode-remove-0")).toBeEnabled());
      fireEvent.click(screen.getByTestId("game-edit-mode-remove-0"));
      fireEvent.click(screen.getByTestId("game-save-modi"));
    }

    test("Rückfrage mit der Zahl der Maps, dann geht es zum Server", async () => {
      usage = { modes: { gp4: { label: "Grand Prix", maps: 3, pools: 0, seasons: 0, in_use: false } } };
      await removeAndSave();
      await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Modus „Grand Prix“ entfernen?", description: expect.stringContaining("3 Maps verlieren"),
      })));
      await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ match_modes: [] })));
    });

    test("wer abbricht, speichert nichts und behält den Entwurf", async () => {
      usage = { modes: { gp4: { label: "Grand Prix", maps: 3, pools: 1, seasons: 0, in_use: false } } };
      confirmMock.mockResolvedValue(false);
      await removeAndSave();
      await waitFor(() => expect(confirmMock).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(apiMock.patch).not.toHaveBeenCalled();
      expect(screen.getByTestId("game-edit-modes-empty")).toBeInTheDocument();
      expect(screen.getByTestId("game-tab-dirty-modi")).toBeInTheDocument();
    });

    test("hängt nichts daran, gibt es keine Frage", async () => {
      usage = { modes: { gp4: { label: "Grand Prix", maps: 0, pools: 0, seasons: 0, in_use: false } } };
      await removeAndSave();
      await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({ match_modes: [] })));
      expect(confirmMock).not.toHaveBeenCalled();
    });

    // #2206: Ein verwendeter Modus hat kein Entfernen, nur den Hinweis; die Zählung fragt die Seite beim Öffnen ab.
    test("verwendet: Schloss statt Papierkorb, deaktivieren geht", async () => {
      usage = { modes: { gp4: { label: "Grand Prix", maps: 2, pools: 1, seasons: 0, pool_versions: 1, in_use: true } } };
      renderPage("/admin/games/g1#modi");
      expect(await screen.findByTestId("game-edit-mode-locked-0")).toBeInTheDocument();
      expect(screen.queryByTestId("game-edit-mode-remove-0")).toBeNull();
      expect(apiMock.get).toHaveBeenCalledWith("/games/g1/usage");
      fireEvent.click(screen.getByTestId("game-edit-mode-more-0"));
      fireEvent.change(screen.getByTestId("game-edit-mode-status-0"), { target: { value: "archived" } });
      fireEvent.click(screen.getByTestId("game-save-modi"));
      await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/games/g1", expect.objectContaining({
        match_modes: [{ mode: "gp4", label: "Grand Prix", minutes: 12, per_game: false, status: "archived" }],
      })));
      expect(confirmMock).not.toHaveBeenCalled();
    });
  });
});

test("Maps ohne Modi: der Hinweis führt in den Reiter Modi", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/games/g1/maps") return { data: { ...MAPS, maps: [{ id: "m1", slug: "kurs", name: "Kurs", modes: [], status: "active", in_pools: 0 }] } };
    if (url === "/games/discord-servers") return { data: [] };
    if (url === "/games") return { data: [game] };
    if (url === "/games/g1/usage") return { data: usage };
    return { data: game };
  });
  renderPage("/admin/games/g1#maps");
  const hint = await screen.findByTestId("game-maps-no-modes");
  fireEvent.click(within(hint).getByRole("button", { name: "Modi anlegen" }));
  expect(lastLocation.hash).toBe("#modi");
});
