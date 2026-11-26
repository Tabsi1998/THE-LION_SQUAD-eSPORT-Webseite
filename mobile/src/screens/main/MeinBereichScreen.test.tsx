import React from "react";
import { NavigationContext } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { MeinBereichScreen } from "./MeinBereichScreen";

// Mein Bereich (#2059, #1677): der Tab (früher „Profil“) mit wer ich bin, Suche, „Zu tun“, „Häufig gebraucht“ und allen
// Gruppen - dieselben Namen wie im Web. Gäste sehen den Weg zum Konto und nur, was ohne Konto geht.

const mockUser: { value: Record<string, unknown> | null } = { value: null };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockUser.value, refreshMe: jest.fn(async () => undefined), logout: jest.fn() }) }));
jest.mock("../../live", () => ({ isGuestUser: (user: { id?: string } | null) => !user || user.id === "guest" }));
const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (value: string) => value,
}));
const mockNavigateToUrl = jest.fn((_url: string) => true);
const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({
  navigateToUrl: (url: string) => mockNavigateToUrl(url),
  openSignIn: (...args: unknown[]) => mockOpenSignIn(...args),
  openDetail: jest.fn(),
  targetFromUrl: () => null,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: ({ fallback }: { fallback?: React.ReactNode }) => fallback || null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, appNamesSeason: () => true }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
jest.mock("../../update/AppUpdateProvider", () => ({ useOptionalAppUpdate: () => ({ openWhatsNew: jest.fn() }) }));

const navigate = jest.fn();
const navigation = { navigate, addListener: jest.fn(() => () => {}), isFocused: () => true } as never;

const MEMBER = { id: "u-1", username: "neonfalke", display_name: "NeonFalke", is_club_member: true, avatar_url: null };

function answers(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    "/account/invoices": { currency: "EUR", summary: { open_count: 1, open_total: 12, overdue_count: 0 } },
    "/prizes/me/open-count": { count: 2 },
    "/membership/me": { dolibarr: { led_by_dolibarr: true, fee: { status: "paid" } } },
    "/membership/me/consents": { available: true, consents: [{ code: "fotos", label: "Fotos", state: "given", can_give: true, text_changed: true }] },
    "/membership/me/jersey-number": { available: true, can_choose: true, number: null },
    "/membership/area-summary": { meetings_open: 3, ballots_open: 2 },
    ...overrides,
  };
  mockGet.mockImplementation((path: string) => (path in data ? Promise.resolve({ data: data[path] }) : Promise.reject(new Error(`unerwartet ${path}`))));
}

function renderBereich() {
  return render(
    <NavigationContext.Provider value={navigation}>
      <MeinBereichScreen />
    </NavigationContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.value = MEMBER;
  answers();
});

test("Mitglied: wer ich bin, „Zu tun“ nur mit Pflichtigem, fünf Wege und alle acht Gruppen mit den Namen des Webs", async () => {
  await renderBereich();
  expect(screen.getByTestId("mein-bereich-header-title")).toHaveTextContent("Mein Bereich");
  expect(screen.getByTestId("mein-bereich-name")).toHaveTextContent("NeonFalke");
  expect(screen.getByTestId("mein-bereich-member")).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId("mein-bereich-todo-rechnung")).toBeTruthy());
  const todo = within(screen.getByTestId("mein-bereich-todo"));
  // Abstimmungen nicht doppelt: 2 Abstimmungen + 1 Einladung = 3 wie meetings_open.
  expect(todo.getByText("2 Abstimmungen offen")).toBeTruthy();
  expect(todo.getByText("Zur Versammlung antworten")).toBeTruthy();
  expect(todo.getByText("Einwilligung geändert – bitte neu lesen")).toBeTruthy();
  expect(todo.getByText("Nummer wählen")).toBeTruthy();
  expect(todo.getByText("2 Gewinne abholen")).toBeTruthy();

  const tiles = ["nummer", "anschrift", "rechnungen", "passwort", "loeschung"];
  for (const key of tiles) expect(screen.getByTestId(`mein-bereich-schnell-${key}`)).toBeTruthy();
  expect(screen.getByTestId("mein-bereich-schnell-anschrift")).toHaveTextContent("Anschrift ändern");

  const labels = ["Profil", "Mitgliedschaft", "Rechnungen & Unterlagen", "Verein", "Benachrichtigungen", "Konto & Sicherheit", "Datenschutz"];
  const keys = ["profil", "mitgliedschaft", "rechnungen", "verein", "benachrichtigungen", "konto", "datenschutz"];
  keys.forEach((key, index) => expect(screen.getByTestId(`mein-bereich-liste-${key}`)).toHaveTextContent(new RegExp(labels[index].replace(/&/g, "&"))));
  // Die Zahl an der Gruppe zählt wie die Seite: Verein 3 offen, Rechnungen 1 Rechnung + 2 Gewinne.
  expect(screen.getByTestId("mein-bereich-liste-verein")).toHaveTextContent(/3 offen/);
  expect(screen.getByTestId("mein-bereich-liste-rechnungen")).toHaveTextContent(/3 offen/);
});

test("ein Tipp führt hin: Zu tun, Kachel, Gruppe und der Kopf mit dem eigenen Profil", async () => {
  await renderBereich();
  await waitFor(() => expect(screen.getByTestId("mein-bereich-todo-nummer")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("mein-bereich-todo-nummer"));
  expect(mockNavigateToUrl).toHaveBeenLastCalledWith("/mein-bereich/mitgliedschaft#nummer");
  await fireEvent.press(screen.getByTestId("mein-bereich-schnell-passwort"));
  expect(mockNavigateToUrl).toHaveBeenLastCalledWith("/mein-bereich/konto#passwort");
  await fireEvent.press(screen.getByTestId("mein-bereich-schnell-loeschung"));
  expect(mockNavigateToUrl).toHaveBeenLastCalledWith("/mein-bereich/datenschutz?tab=loeschung");
  await fireEvent.press(screen.getByTestId("mein-bereich-liste-konto"));
  expect(navigate).toHaveBeenLastCalledWith("MeinBereichGruppe", { gruppe: "konto" });
  await fireEvent.press(screen.getByTestId("mein-bereich-identity"));
  expect(navigate).toHaveBeenLastCalledWith("OwnProfile");
});

test("kein Mitglied, ohne Verein: drei Wege, kein „Verein“, keine Vereinsabfragen - und „Alles erledigt“", async () => {
  mockUser.value = { id: "u-2", username: "gastspieler", display_name: "Ein sehr langer Anzeigename, der nicht in eine Zeile passt", is_club_member: false };
  answers({ "/account/invoices": { summary: { open_count: 0 } }, "/prizes/me/open-count": { count: 0 } });
  await renderBereich();
  await waitFor(() => expect(screen.getByTestId("mein-bereich-todo-empty")).toHaveTextContent("Alles erledigt – gerade ist nichts offen."));
  expect(screen.queryByTestId("mein-bereich-schnell-nummer")).toBeNull();
  expect(screen.queryByTestId("mein-bereich-schnell-anschrift")).toBeNull();
  expect(screen.getByTestId("mein-bereich-schnell-rechnungen")).toBeTruthy();
  expect(screen.queryByTestId("mein-bereich-liste-verein")).toBeNull();
  expect(screen.getByTestId("mein-bereich-liste-mitgliedschaft")).toBeTruthy();
  expect(screen.queryByTestId("mein-bereich-member")).toBeNull();
  const asked = mockGet.mock.calls.map(([path]) => String(path));
  expect(asked.filter((path) => path.startsWith("/membership"))).toEqual([]);
  // Ein langer Name bricht höchstens auf zwei Zeilen um - er sprengt den Kopf nicht und bleibt mit großer Schrift lesbar.
  expect(screen.getByTestId("mein-bereich-name").props.numberOfLines).toBe(2);
});

test("Server antwortet nicht: „Zu tun“ zeigt, was da ist - ohne Fehler im Gesicht", async () => {
  mockGet.mockImplementation(() => Promise.reject(new Error("offline")));
  await renderBereich();
  await waitFor(() => expect(screen.getByTestId("mein-bereich-todo-empty")).toBeTruthy());
  expect(screen.getByTestId("mein-bereich-liste-konto")).toBeTruthy();
});

test("Suche: filtert beim Tippen, findet jede Einstellung, leert sich mit dem Kreuz - ein Treffer führt direkt hin", async () => {
  await renderBereich();
  await fireEvent.changeText(screen.getByTestId("mein-bereich-suche"), "r");
  // Ein Zeichen sucht noch nicht - die Übersicht bleibt stehen.
  expect(screen.getByTestId("mein-bereich-start")).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId("mein-bereich-suche"), "Ruhezeit");
  expect(screen.queryByTestId("mein-bereich-start")).toBeNull();
  expect(screen.getByTestId("mein-bereich-treffer-zahl")).toHaveTextContent("1 Treffer");
  await fireEvent.press(screen.getByTestId("mein-bereich-treffer-benachrichtigungen-ruhezeit"));
  expect(mockNavigateToUrl).toHaveBeenLastCalledWith("/mein-bereich/benachrichtigungen#ruhezeit");

  await fireEvent.changeText(screen.getByTestId("mein-bereich-suche"), "Kalender");
  await fireEvent.press(screen.getByTestId("mein-bereich-treffer-konto-kalender-abo"));
  expect(mockNavigateToUrl).toHaveBeenLastCalledWith("/mein-bereich/konto?tab=calendar");

  await fireEvent.changeText(screen.getByTestId("mein-bereich-suche"), "xylophon");
  expect(screen.getByTestId("mein-bereich-suche-leer")).toHaveTextContent(/Nichts gefunden zu „xylophon“/);
  await fireEvent.press(screen.getByTestId("mein-bereich-suche-leeren"));
  expect(screen.getByTestId("mein-bereich-suche").props.value).toBe("");
  expect(screen.getByTestId("mein-bereich-start")).toBeTruthy();
});

test("Suche ohne Sprung: ein Treffer, der beim Weitertippen bleibt, bleibt dieselbe Zeile", async () => {
  await renderBereich();
  await fireEvent.changeText(screen.getByTestId("mein-bereich-suche"), "pass");
  const first = screen.getByTestId("mein-bereich-treffer-konto-passwort");
  await fireEvent.changeText(screen.getByTestId("mein-bereich-suche"), "passwort");
  expect(screen.getByTestId("mein-bereich-treffer-konto-passwort")).toBe(first);
});

test("Gast: der Weg zum Konto, darunter nur Darstellung und Über die App - keine einzige Anfrage", async () => {
  mockUser.value = null;
  await renderBereich();
  expect(screen.getByTestId("mein-bereich-header-title")).toHaveTextContent("Mein Bereich");
  expect(screen.getByTestId("profile-guest")).toBeTruthy();
  expect(screen.getByTestId("settings-group-appearance")).toBeTruthy();
  expect(screen.getByTestId("settings-group-about")).toBeTruthy();
  expect(screen.queryByTestId("mein-bereich-suche")).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("profile-guest-login"));
  expect(mockOpenSignIn).toHaveBeenLastCalledWith("Login");
  await fireEvent.press(screen.getByTestId("profile-guest-register"));
  expect(mockOpenSignIn).toHaveBeenLastCalledWith("Register");
});

test("Kontowechsel: eine späte Antwort des vorigen Kontos landet nicht in „Zu tun“", async () => {
  const late: Array<(value: unknown) => void> = [];
  mockGet.mockImplementation((path: string) => (path === "/account/invoices" ? new Promise((resolve) => { late.push(resolve); }) : Promise.resolve({ data: null })));
  const view = await renderBereich();
  // Solange „Zu tun“ lädt, steht ein Platzhalter da - die Fläche springt nicht.
  expect(screen.getByTestId("mein-bereich-todo-loading")).toBeTruthy();
  mockUser.value = { id: "u-9", username: "zweites", is_club_member: false };
  await view.rerender(
    <NavigationContext.Provider value={navigation}>
      <MeinBereichScreen />
    </NavigationContext.Provider>,
  );
  await act(async () => { late[0]({ data: { summary: { open_count: 5 } } }); });
  await act(async () => { late[1]({ data: { summary: { open_count: 0 } } }); });
  await waitFor(() => expect(screen.getByTestId("mein-bereich-todo-empty")).toBeTruthy());
  expect(screen.queryByTestId("mein-bereich-todo-rechnung")).toBeNull();
});
