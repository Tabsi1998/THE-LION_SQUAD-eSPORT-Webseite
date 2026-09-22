import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MemberAreaScreen } from "./MemberAreaScreen";

// Mitgliederbereich in der App (#340): zeigt, was der Server für diese Person freigibt, und
// verweist auf Mitgliedschaft, Karte, Dokumente, Vorteile. Ein Ausfall einer Quelle nimmt die
// anderen nicht mit.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1", username: "paula", display_name: "Paula", is_club_member: true } }) }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => undefined }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));

const navigate = jest.fn();
const parentNavigate = jest.fn();
const navigation = { navigate, getParent: () => ({ navigate: parentNavigate }) } as never;
const route = { key: "area", name: "MemberArea" } as never;

const responses: Record<string, unknown> = {
  "/membership/me": { membership: { member_number: "TLS-0007", member_since: "2024-03-01" } },
  "/events": [
    { id: "e1", slug: "lan", name: "LAN im Vereinsheim", visibility: "members", start_date: "2099-10-05T18:00:00Z", location: "Vereinsheim" },
    { id: "e2", slug: "fest", name: "Öffentliches Fest", visibility: "public", start_date: "2099-10-06T18:00:00Z" },
  ],
  "/news": [{ id: "n1", slug: "intern", title: "Nur für Mitglieder", visibility: "members", created_at: "2026-09-20T10:00:00Z" }, { id: "n2", slug: "pub", title: "Für alle", visibility: "public" }],
  "/documents": [{ id: "d1", title: "Statuten" }, { id: "d2", title: "Protokoll" }],
  "/membership/benefits": [{ id: "b1", title: "Rabatt im Shop", description: "10 Prozent" }],
  "/board": [{ id: "p1", display_title: "Obfrau", user: { display_name: "Obfrau Otti", username: "otti" } }],
  "/settings/public": { discord_invite_url: "https://discord.gg/lions" },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation((path: string) => (path in responses ? Promise.resolve({ data: responses[path] }) : Promise.reject(new Error("nope"))));
});

test("zeigt nur Internes, mit Kacheln zu Mitgliedschaft, Karte, Dokumenten und Vorteilen", async () => {
  await render(<MemberAreaScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("LAN im Vereinsheim")).toBeTruthy());

  expect(screen.getByText(/Nr\. TLS-0007/)).toBeTruthy();
  expect(screen.queryByText("Öffentliches Fest")).toBeNull();
  expect(screen.getByText("Nur für Mitglieder")).toBeTruthy();
  expect(screen.queryByText("Für alle")).toBeNull();
  expect(screen.getByText("Dokumente (2)")).toBeTruthy();
  expect(screen.getByText("Obfrau Otti")).toBeTruthy();
  expect(screen.getByText("Rabatt im Shop")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("member-area-membership"));
  expect(navigate).toHaveBeenCalledWith("MyMembership");
  await fireEvent.press(screen.getByTestId("member-area-card"));
  expect(navigate).toHaveBeenCalledWith("MemberCard");
  await fireEvent.press(screen.getByTestId("member-area-documents"));
  expect(navigate).toHaveBeenCalledWith("MemberDocuments");
  await fireEvent.press(screen.getByTestId("member-area-benefits"));
  expect(navigate).toHaveBeenCalledWith("InfoCenter", { section: "benefits" });

  await fireEvent.press(screen.getByText("LAN im Vereinsheim"));
  expect(parentNavigate).toHaveBeenCalledWith("Tournaments", { screen: "EventDetail", params: { id: "lan" } });
  await fireEvent.press(screen.getByText("Obfrau Otti"));
  expect(navigate).toHaveBeenCalledWith("PublicProfile", { username: "otti" });

  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await fireEvent.press(screen.getByTestId("member-area-discord"));
  expect(openUrl).toHaveBeenCalledWith("https://discord.gg/lions");
});

test("ohne Inhalte ein ruhiger Hinweis; eine kaputte Quelle reißt die anderen nicht mit", async () => {
  mockGet.mockImplementation((path: string) => {
    if (path === "/documents") return Promise.reject(new Error("503"));
    if (path === "/membership/me") return Promise.resolve({ data: { membership: null } });
    return Promise.resolve({ data: [] });
  });
  await render(<MemberAreaScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Noch nichts Neues")).toBeTruthy());
  expect(screen.getByText("Dokumente")).toBeTruthy();
  expect(screen.getByText("Aktives Mitglied")).toBeTruthy();
  expect(screen.queryByTestId("member-area-discord")).toBeNull();
});
