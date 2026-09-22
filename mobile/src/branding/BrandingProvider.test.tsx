import React from "react";
import { Text } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { BrandingProvider, useBranding } from "./BrandingProvider";

// Vereinsname und Markenbilder kommen aus /settings/public (#229) - ohne Provider und ohne Netz
// gelten die eingebauten Werte, eine Änderung im Admin kommt live an.

const mockGet = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  resolveMediaUrl: (url?: string | null) => (url ? `https://app.example${url}` : ""),
}));
const mockLiveRefresh = jest.fn();
jest.mock("../realtime/LiveChangesProvider", () => ({
  useLiveRefresh: (callback: () => unknown, resources: string[]) => mockLiveRefresh(callback, resources),
}));

function Probe() {
  const branding = useBranding();
  return <Text testID="probe">{`${branding.clubName}|${branding.logoUrl}|${branding.loaded ? "geladen" : "eingebaut"}`}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("ohne Provider die eingebauten Werte", async () => {
  await render(<Probe />);
  expect(screen.getByTestId("probe")).toHaveTextContent("THE LION SQUAD||eingebaut");
  expect(mockGet).not.toHaveBeenCalled();
});

test("mit Provider die Einstellungen des Vereins, live bei Änderung", async () => {
  mockGet.mockResolvedValue({ data: { club_name: "LION e.V.", logo_dark_url: "/api/static/uploads/dark.png" } });
  await render(
    <BrandingProvider>
      <Probe />
    </BrandingProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("LION e.V.|https://app.example/api/static/uploads/dark.png|geladen"));
  expect(mockGet).toHaveBeenCalledWith("/settings/public");
  expect(mockLiveRefresh).toHaveBeenCalledWith(expect.any(Function), ["settings", "branding"]);

  // Der Admin ändert den Namen: der Live-Rückruf lädt neu.
  mockGet.mockResolvedValue({ data: { club_name: "LION neu" } });
  const [reload] = mockLiveRefresh.mock.calls[0];
  await reload();
  await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("LION neu||geladen"));
});

test("ohne Netz bleiben die eingebauten Werte stehen", async () => {
  mockGet.mockRejectedValue(new Error("Network Error"));
  await render(
    <BrandingProvider>
      <Probe />
    </BrandingProvider>,
  );
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.getByTestId("probe")).toHaveTextContent("THE LION SQUAD||eingebaut");
});
