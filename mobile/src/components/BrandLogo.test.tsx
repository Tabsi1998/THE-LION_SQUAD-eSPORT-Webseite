import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { BrandLogo } from "./BrandLogo";

// Logo aus den Einstellungen (#229): das Bild des Vereins, wenn es eines gibt - und das
// eingebaute, wenn es fehlt oder nicht lädt.

const mockBranding = { clubName: "LION e.V.", logoUrl: "", mascotUrl: "", loaded: true };
jest.mock("../branding/BrandingProvider", () => ({ useBranding: () => mockBranding }));

beforeEach(() => {
  mockBranding.logoUrl = "";
  mockBranding.mascotUrl = "";
});

test("ohne Bild in den Einstellungen das eingebaute Wortzeichen", async () => {
  await render(<BrandLogo />);
  const image = screen.getByTestId("brand-logo");
  expect(image.props.source).not.toEqual(expect.objectContaining({ uri: expect.anything() }));
  expect(image.props.accessibilityLabel).toBe("LION e.V.");
});

test("mit Bild das des Vereins; lädt es nicht, wieder das eingebaute", async () => {
  mockBranding.logoUrl = "https://lionsquad.example/api/static/uploads/logo.png";
  mockBranding.mascotUrl = "https://lionsquad.example/api/static/uploads/mascot.png";
  await render(<BrandLogo variant="mascot" testID="mascot" />);
  const image = screen.getByTestId("mascot");
  expect(image.props.source).toEqual({ uri: "https://lionsquad.example/api/static/uploads/mascot.png" });

  await fireEvent(image, "error");
  expect(screen.getByTestId("mascot").props.source).not.toEqual(expect.objectContaining({ uri: expect.anything() }));
});
