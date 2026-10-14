import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ConsentScreen } from "./ConsentScreen";
import { API_BASE_URL, WEBSITE_BASE_URL } from "../../config";

// Aktualisierte Bedingungen (#1537): Datenschutz und Nutzungsbedingungen sind Seiten der Website - die Links gehen über die
// eigene Website-Adresse, nie über die Adresse der API (im Entwicklungsbuild ist das das Backend, nicht die Website).

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: { required_privacy_policy_version: "3", required_terms_version: "2" }, refreshMe: jest.fn(), logout: jest.fn() }),
}));
jest.mock("../../lib/api", () => ({ api: { post: jest.fn() }, errorMessage: (_error: unknown, fallback: string) => fallback }));

test("Datenschutz und Nutzungsbedingungen öffnen die Website, nicht die API", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<ConsentScreen />);
  await fireEvent.press(screen.getByText("Datenschutzerklärung öffnen"));
  await fireEvent.press(screen.getByText("Nutzungsbedingungen öffnen"));
  expect(open).toHaveBeenNthCalledWith(1, `${WEBSITE_BASE_URL}/privacy`);
  expect(open).toHaveBeenNthCalledWith(2, `${WEBSITE_BASE_URL}/terms`);
  // Im Entwicklungsbuild (Jest) laufen Website und Backend getrennt: Vite auf 3000, das Backend auf 8001.
  expect(WEBSITE_BASE_URL).toBe("http://10.0.2.2:3000");
  expect(WEBSITE_BASE_URL).not.toBe(API_BASE_URL);
  open.mockRestore();
});
