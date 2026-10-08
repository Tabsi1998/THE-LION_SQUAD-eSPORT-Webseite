import React from "react";
import { AccessibilityInfo } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { cardNumberLine, MemberCardArt, validLine } from "./MemberCardArt";

// Die Mitgliedskarte wie im Web (#1335): schwarz mit Gold, Name, Nummer mit Jahr, Art und „gültig bis“; das Logo in Gold;
// der Lichtlauf nur ohne „Bewegung reduzieren“.

afterEach(() => jest.restoreAllMocks());

test("Name, Nummer, Art und gültig bis auf der Karte; Logo in Gold", async () => {
  await render(<MemberCardArt name="LunaByte" number="TLS-031" since="2024-03-01" typeLabel="Ordentliches Mitglied" validUntil="2026-12-31" />);
  expect(screen.getByTestId("member-card-art-name")).toHaveTextContent("LunaByte");
  expect(screen.getByText("Nr. TLS-031 · seit 2024")).toBeTruthy();
  expect(screen.getByText("Ordentliches Mitglied · gültig bis 31.12.2026")).toBeTruthy();
  expect(screen.getByTestId("member-card-art-logo").props.style).toEqual(expect.objectContaining({ tintColor: "#FFD700" }));
  expect(screen.getByTestId("member-card-art").props.accessibilityLabel).toBe("Mitgliedskarte LunaByte, Nr. TLS-031 · seit 2024, Ordentliches Mitglied · gültig bis 31.12.2026");
});

test("mit „Bewegung reduzieren“ kein Lichtlauf", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  await render(<MemberCardArt name="Dein Name" number="0042" />);
  await waitFor(() => expect(screen.queryByTestId("member-card-art-shine")).toBeNull());
});

test("Hilfsfunktionen", () => {
  expect(cardNumberLine("0042", 2026)).toBe("Nr. 0042 · seit 2026");
  expect(cardNumberLine(null, null)).toBe("");
  expect(validLine("2026-12-31")).toBe("gültig bis 31.12.2026");
  expect(validLine("")).toBe("");
});
