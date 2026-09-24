import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Einrichtungsanleitungen: Schritte mit Link zur Konsole und dem Wert zum Kopieren - die
// Rückrufadresse trägt die Adresse der Website, nicht einen Platzhalter.

const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SetupGuide } = await import("./SetupGuide");
const { SETUP_GUIDES, SETUP_GUIDE_ORDER, guideStatus } = await import("@/lib/setupGuides");

test("Discord-App: Schritte, Link ins Developer Portal, Rückrufadresse mit der Adresse der Website zum Kopieren", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<MemoryRouter><SetupGuide guideKey="discord_app" open showWhere status={{ state: "missing", text: "Client ID oder Secret fehlt" }} /></MemoryRouter>);
  const guide = screen.getByTestId("setup-guide-discord_app");
  expect(guide).toHaveTextContent("So richtest du es ein: Discord: Konten verknüpfen");
  expect(guide).toHaveTextContent("Fehlt · Client ID oder Secret fehlt");
  expect(screen.getByTestId("setup-link-discord_app-0")).toHaveAttribute("href", "https://discord.com/developers/applications");
  expect(screen.getByTestId("setup-value-discord_app-3")).toHaveTextContent(`${window.location.origin}/api/platform-links/discord/callback`);
  fireEvent.click(screen.getByTestId("setup-copy-discord_app-3"));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/platform-links/discord/callback`));
  expect(toastMock.success).toHaveBeenCalledWith("Kopiert.");
  expect(screen.getByTestId("setup-where-discord_app")).toHaveAttribute("href", "/admin/integrations/discord");
});

test("jede Anleitung hat Titel, Ort, Schritte - und der Stand folgt den Admin-Daten", () => {
  for (const key of SETUP_GUIDE_ORDER) {
    const guide = SETUP_GUIDES[key];
    expect(guide.title).toBeTruthy();
    expect(guide.where?.to).toMatch(/^\/admin/);
    expect(guide.steps.length).toBeGreaterThan(1);
  }
  expect(guideStatus("discord_app", { links: { discord: false } }).state).toBe("missing");
  expect(guideStatus("discord_app", { links: { discord: true } }).state).toBe("ok");
  expect(guideStatus("twitch", { branding: { twitch_client_id: "abc", twitch_client_secret_masked: "****", twitch_channel: "tls" } })).toEqual({ state: "ok", text: "App und Kanal tls" });
  expect(guideStatus("analytics", { branding: { analytics_provider: "google", google_analytics_id: "" } }).state).toBe("missing");
  expect(guideStatus("play_store", { branding: {} }).state).toBe("optional");
  expect(guideStatus("resend", {}).state).toBe("unknown");
});
