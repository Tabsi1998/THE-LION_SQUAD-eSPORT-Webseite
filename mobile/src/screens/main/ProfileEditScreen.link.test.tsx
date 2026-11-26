import React from "react";
import { AppState, Linking, Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ProfileEditScreen } from "./ProfileEditScreen";

// Konten verknüpfen aus der App (#521, #2059): öffnet die Website (kein App-Link - sonst käme wieder die App), und wer danach
// zurückkommt, sieht gleich, was jetzt verknüpft ist.

const mockGet = jest.fn(async () => ({ data: { links: [], available: { discord: true }, disabled: [] } }));
// Gleichbleibende Objekte - ein neues Konto bei jedem Zeichnen ließe die Speicher-Warteschlange endlos neu laden.
const mockAuth = { user: { id: "u-1", username: "neonfalke" }, refreshMe: async () => undefined };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../lib/api", () => ({
  api: { get: () => mockGet(), patch: jest.fn(async () => ({ data: {} })), post: jest.fn(), delete: jest.fn() },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("../../components/ImagePickField", () => ({ ImagePickField: () => null }));
jest.mock("../../components/LinkedAccounts", () => {
  const { Pressable, Text: RNText } = jest.requireActual("react-native");
  return {
    LINKABLE_PLATFORMS: ["discord"],
    PlatformLinkRows: ({ onLink }: { onLink: (platform: string) => void }) => (
      <Pressable testID="link-discord" onPress={() => onLink("discord")}><RNText>Discord verknüpfen</RNText></Pressable>
    ),
  };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, appNamesSeason: () => true }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
jest.mock("../../navigation/rootNavigation", () => ({ navigateToUrl: () => false }));

test("Verknüpfen öffnet Mein Bereich → Profil → Socials auf der Website; zurück in der App lädt die Liste neu", async () => {
  const handlers: Array<(state: string) => void> = [];
  const listen = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: (state: string) => void) => {
    handlers.push(handler);
    return { remove: jest.fn() };
  }) as never);
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  try {
    await render(<ProfileEditScreen />);
    expect(screen.getAllByText(/Discord verknüpfen/).length).toBeGreaterThan(0);
    const before = mockGet.mock.calls.length;
    await fireEvent.press(screen.getByTestId("link-discord"));
    expect(String(open.mock.calls[0][0])).toMatch(/\/mein-bereich\/profil\?tab=socials&link=discord$/);
    // Ohne Verknüpfen kein Nachladen; nach dem Verknüpfen genau einmal, sobald die App wieder vorn ist.
    await act(async () => { handlers.forEach((handler) => handler("active")); });
    expect(mockGet.mock.calls.length).toBe(before + 1);
    await act(async () => { handlers.forEach((handler) => handler("active")); });
    expect(mockGet.mock.calls.length).toBe(before + 1);
    expect(Text).toBeTruthy();
  } finally {
    listen.mockRestore();
    open.mockRestore();
  }
});
