import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Verknüpfte Konten (#260): jedes bestätigte Konto steht mit Rahmen in Plattformfarbe, Anzeigename,
// Datum und der offiziellen Adresse im öffentlichen Profil - man sieht, dass es echt ist und wohin es geht.

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() }, formatRequestError: (e, f) => f, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ consent: {}, allow: () => {} }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { LinkedAccountsCard } = await import("./PublicProfilePage");

test("verknüpfte Konten: Rahmen, Anzeigename, Datum und offizieller Link je Plattform", () => {
  render(
    <MemoryRouter>
      <LinkedAccountsCard accounts={[
        { platform: "discord", label: "Discord", handle: "paula", display_name: "Paula B.", linked_at: "2026-09-22T20:00:00Z", url: "https://discord.com/users/123" },
        { platform: "steam", label: "Steam", handle: "76561198000000001", display_name: "76561198000000001", linked_at: "2026-09-23T20:00:00Z", url: "https://steamcommunity.com/profiles/76561198000000001" },
      ]} />
    </MemoryRouter>
  );
  expect(screen.getByTestId("public-profile-linked")).toHaveTextContent("Verknüpfte Konten");
  const discord = screen.getByTestId("linked-account-discord");
  expect(discord).toHaveAttribute("href", "https://discord.com/users/123");
  expect(discord).toHaveTextContent("Paula B.");
  expect(discord).toHaveTextContent("Discord · paula · seit 22.09.2026");
  expect(discord.style.getPropertyValue("--social-color")).toBe("#5865F2");
  expect(screen.getByTestId("linked-account-discord-verified")).toBeInTheDocument();
  const steam = screen.getByTestId("linked-account-steam");
  expect(steam).toHaveAttribute("href", "https://steamcommunity.com/profiles/76561198000000001");
  // Ohne Steam-Schlüssel ist der Name die ID: dann „Steam-Profil“ groß, die ID klein - nicht doppelt.
  expect(steam).toHaveTextContent("Steam-Profil");
  expect(steam).toHaveTextContent("Steam · 76561198000000001 · seit 23.09.2026");
  expect(steam).not.toHaveTextContent("76561198000000001 · 76561198000000001");
  expect(steam.style.getPropertyValue("--social-color")).toBe("#66C0F4");
});
