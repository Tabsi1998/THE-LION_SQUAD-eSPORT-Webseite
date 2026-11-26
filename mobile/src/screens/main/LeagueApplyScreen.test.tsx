import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LeagueApplyScreen } from "./LeagueApplyScreen";

// Mit Co-Team anmelden in der App (#2542, docs/LIGA.md B.4, Web: LeagueApplyPage.jsx): vier Schritte, ohne Vorwissen bedienbar - Co-Team
// wählen, Prüfung im Klartext, Regeln und Datenschutz zustimmen, einreichen. Geprüft wird beim Einreichen noch einmal auf dem Server.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../lib/openLink", () => ({ openLink: jest.fn(() => "browser") }));
let mockUser: Record<string, unknown> | null = { id: "u1", username: "kapitaen" };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("../../live", () => ({ isGuestUser: (user: { id?: string } | null) => !user || user.id === "guest" }));
const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: (...args: unknown[]) => mockOpenSignIn(...args) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigate = jest.fn();
const goBack = jest.fn();
const navigation = { navigate, goBack, setOptions: jest.fn(), canGoBack: () => true } as never;
const route = { key: "apply", name: "LeagueApply", params: { league: "cod", season: "season-3" } } as never;

const RULES = { version_id: "v7", title: "Regelwerk CoD-Liga", label: "Fassung 3", valid_from: "2026-11-01", url: "/liga/cod/season-3/regeln", pdf_url: "/api/leagues/cod/rules/v7.pdf" };
const PRIVACY = { text: "Wir speichern Name und Spiel-ID für die Liga.", url: "/datenschutz" };
const squad = (id: string, extra: Record<string, unknown> = {}) => ({ squad_id: id, team_id: "t1", display_name: `Löwen ${id}`, member_count: 5, state: "none", can_apply: true, problems: [], warnings: [], ...extra });
const view = (extra: Record<string, unknown> = {}) => ({ application: { state: "open", auto_accept: false }, squads: [squad("s1")], season_problems: [], rules: RULES, privacy: PRIVACY,
  platform: { field_label: "Plattform", allowed: ["PC"], crossplay: false }, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: "u1", username: "kapitaen" };
});

async function next() {
  await fireEvent.press(screen.getByTestId("apply-next"));
}

test("vier Schritte: einziges Co-Team vorgewählt, Prüfung, beides zustimmen, einreichen mit der gesehenen Fassung", async () => {
  mockGet.mockResolvedValue({ data: view() });
  mockPost.mockResolvedValue({ data: { status: "submitted" } });
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-step-title")).toHaveTextContent("Welches Co-Team meldest du an?"));
  expect(mockGet).toHaveBeenCalledWith("/leagues/cod/season-3/application");
  expect(screen.getByTestId("apply-squad-s1").props.accessibilityState).toMatchObject({ checked: true });
  await next();
  expect(screen.getByTestId("apply-step-title")).toHaveTextContent("Passt alles?");
  expect(screen.getByTestId("apply-check-ok")).toHaveTextContent("Löwen s1 erfüllt die Vorgaben dieser Season.");
  expect(screen.getByTestId("apply-platform")).toHaveTextContent(/Plattform: nur PC\./);
  await next();
  expect(screen.getByTestId("apply-rules-version")).toHaveTextContent("Fassung 3 · gültig ab 01.11.2026");
  expect(screen.getByTestId("apply-next").props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent(screen.getByTestId("apply-accept-rules"), "valueChange", true);
  expect(screen.getByTestId("apply-next").props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent(screen.getByTestId("apply-accept-privacy"), "valueChange", true);
  await next();
  expect(screen.getByTestId("apply-summary")).toHaveTextContent(/Löwen s1/);
  expect(screen.getByTestId("apply-summary")).toHaveTextContent(/Fassung 3, zugestimmt/);
  await fireEvent.press(screen.getByTestId("apply-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/leagues/cod/season-3/applications", { squad_id: "s1", rule_version_id: "v7", accept_rules: true, accept_privacy: true }));
  await waitFor(() => expect(screen.getByTestId("apply-done")).toHaveTextContent(/^Anmeldung eingereicht\. Die Liga-Leitung prüft sie jetzt\./));
  await fireEvent.press(screen.getByTestId("apply-done-back"));
  expect(goBack).toHaveBeenCalled();
});

test("mehrere Co-Teams: erst wählen; ein laufender Antrag ist nicht wählbar und nennt seinen Stand", async () => {
  mockGet.mockResolvedValue({ data: view({ squads: [squad("s1"), squad("s2", { state: "submitted" }), squad("s3")] }) });
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-squad-s1")).toBeTruthy());
  expect(screen.getByTestId("apply-next").props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByTestId("apply-squad-s2").props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByTestId("apply-squad-s2-state")).toHaveTextContent("Eingereicht");
  await fireEvent.press(screen.getByTestId("apply-squad-s1"));
  expect(screen.getByTestId("apply-next").props.accessibilityState).toMatchObject({ disabled: false });
});

test("Prüfung mit Problemen: Weiter gesperrt, Weg zum Kader; offene Angaben halten nicht auf", async () => {
  mockGet.mockResolvedValue({ data: view({ squads: [squad("s1", { problems: ["Mindestens 4 Spieler im Kader."] })] }) });
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-next")).toBeTruthy());
  await next();
  expect(screen.getByTestId("apply-problems")).toHaveTextContent(/Mindestens 4 Spieler im Kader\./);
  expect(screen.getByTestId("apply-next").props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(screen.getByTestId("apply-team-link"));
  expect(navigate).toHaveBeenCalledWith("TeamDetail", { id: "t1" });
});

test("offene Angaben: die Anmeldung geht trotzdem", async () => {
  mockGet.mockResolvedValue({ data: view({ squads: [squad("s1", { warnings: ["Kiwi: Spiel-ID fehlt"], shortfall: "Noch 1 Spieler mit Spiel-ID nötig." })] }) });
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-next")).toBeTruthy());
  await next();
  expect(screen.getByTestId("apply-check-ok")).toHaveTextContent("Löwen s1 kann angemeldet werden.");
  expect(screen.getByTestId("apply-warnings")).toHaveTextContent(/Kiwi: Spiel-ID fehlt/);
  expect(screen.getByTestId("apply-shortfall")).toHaveTextContent("Noch 1 Spieler mit Spiel-ID nötig.");
  expect(screen.getByTestId("apply-next").props.accessibilityState).toMatchObject({ disabled: false });
});

test("der Server lehnt ab: seine Meldung, Stand neu, Zustimmung neu - die gilt nur der gesehenen Fassung", async () => {
  mockGet.mockResolvedValue({ data: view() });
  mockPost.mockRejectedValue(new Error("Es gibt eine neue Fassung des Regelwerks."));
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-next")).toBeTruthy());
  await next();
  await next();
  await fireEvent(screen.getByTestId("apply-accept-rules"), "valueChange", true);
  await fireEvent(screen.getByTestId("apply-accept-privacy"), "valueChange", true);
  await next();
  await fireEvent.press(screen.getByTestId("apply-submit"));
  await waitFor(() => expect(screen.getByTestId("apply-error")).toHaveTextContent("Es gibt eine neue Fassung des Regelwerks."));
  expect(screen.getByTestId("apply-step-title")).toHaveTextContent("Regeln und Datenschutz");
  expect(screen.getByTestId("apply-accept-rules").props.value).toBe(false);
  expect(screen.getByTestId("apply-accept-privacy").props.value).toBe(false);
  expect(mockGet).toHaveBeenCalledTimes(2);
});

test("automatisch annehmen: die Zusammenfassung sagt, dass das Einreichen gleich zählt", async () => {
  mockGet.mockResolvedValue({ data: view({ application: { state: "open", auto_accept: true } }) });
  mockPost.mockResolvedValue({ data: { status: "accepted" } });
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-next")).toBeTruthy());
  await next();
  await next();
  await fireEvent(screen.getByTestId("apply-accept-rules"), "valueChange", true);
  await fireEvent(screen.getByTestId("apply-accept-privacy"), "valueChange", true);
  await next();
  expect(screen.getByTestId("apply-summary-auto")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("apply-submit"));
  await waitFor(() => expect(screen.getByTestId("apply-done")).toHaveTextContent(/^Angemeldet\. Ihr habt einen Startplatz\./));
});

test("Anmeldung nicht offen, kein eigenes Co-Team, Season unbekannt: je ein Satz statt der Schritte", async () => {
  mockGet.mockResolvedValue({ data: view({ application: { state: "closed" }, season_problems: ["Die Anmeldung ist vorbei."] }) });
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-closed")).toHaveTextContent(/Die Anmeldung ist vorbei\./));

  mockGet.mockResolvedValue({ data: view({ squads: [squad("s1", { can_apply: false })], hint: null }) });
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-none")).toHaveTextContent(/Anmelden dürfen Captain und Vertreter eines Co-Teams für dieses Spiel\./));

  mockGet.mockRejectedValue(new Error("nicht da"));
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-missing")).toBeTruthy());
});

test("break-ui: sehr langer Co-Team-Name bricht um statt abgeschnitten zu werden", async () => {
  const name = "Die außerordentlich ausdauernden Löwen vom Wörthersee eSport-Abteilung Süd-Ost Reserve";
  mockGet.mockResolvedValue({ data: view({ squads: [squad("s1", { display_name: name }), squad("s2")] }) });
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
  expect(screen.getByText(name).props.numberOfLines).toBeUndefined();
});

// Nachbesserung (#2542): Gäste kommen über einen Link hierher - erst anmelden, danach geht es hierher zurück (wie ProtectedRoute im Web).
test("als Gast: Anmelden mit Rücksprung statt der Schritte, kein Abruf", async () => {
  mockUser = { id: "guest" };
  mockGet.mockResolvedValue({ data: view() });
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  expect(screen.getByTestId("apply-sign-in")).toBeTruthy();
  expect(mockGet).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("apply-sign-in-button"));
  expect(mockOpenSignIn).toHaveBeenCalled();
});

test("zweimal schnell „Anmeldung einreichen“: genau ein Antrag", async () => {
  mockGet.mockResolvedValue({ data: view() });
  let finish: (value: unknown) => void = () => {};
  mockPost.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(<LeagueApplyScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("apply-next")).toBeTruthy());
  await next();
  await next();
  await fireEvent(screen.getByTestId("apply-accept-rules"), "valueChange", true);
  await fireEvent(screen.getByTestId("apply-accept-privacy"), "valueChange", true);
  await next();
  const submit = screen.getByTestId("apply-submit");
  await act(async () => {
    fireEvent.press(submit);
    fireEvent.press(submit);
  });
  expect(mockPost).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ data: { status: "submitted" } }); });
});
