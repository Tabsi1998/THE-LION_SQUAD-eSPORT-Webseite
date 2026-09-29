import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Die Teilen-Seite (#619): Karte, Name, Material, Person, Seltenheit, Teilen (Web Share oder Link kopieren),
// Bild speichern; bei 404 der Hinweis „nicht öffentlich“.

const apiMock = { get: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AchievementSharePage } = await import("./AchievementSharePage");

const CARD = {
  award_id: "aw1", tier_code: "matches_played_7", name: "Spielmacher VII", description: "2500 Matches gespielt.", group_name: "Spielmacher", category: "match",
  icon: "swords", material: "diamond", material_name: "Diamant", material_color: "#B9F2FF", rank: 7, points: 160, earned_at: "2026-09-26T18:00:00+00:00",
  holders: 3, percent: 4.2, user: { id: "u1", username: "anna", display_name: "Anna B.", avatar_url: "" }, club_name: "THE LION SQUAD",
  path: "/achievements/a/aw1", image_path: "/api/achievements/share/aw1.png",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/achievements/a/aw1"]}>
      <Routes><Route path="/achievements/a/:awardId" element={<AchievementSharePage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe("AchievementSharePage", () => {
  it("zeigt Karte, Name, Material, Person und Seltenheit; Teilen kopiert ohne Web Share den Link", async () => {
    apiMock.get.mockResolvedValue({ data: CARD });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    expect(await screen.findByTestId("share-name")).toHaveTextContent("Spielmacher VII");
    expect(apiMock.get).toHaveBeenCalledWith("/achievements/award/aw1");
    expect(screen.getByTestId("share-image")).toHaveAttribute("src", "/api/achievements/share/aw1.png");
    expect(screen.getByTestId("share-card")).toHaveTextContent("Diamant");
    expect(screen.getByTestId("share-rarity")).toHaveTextContent("4,2 % haben das");
    expect(screen.getByTestId("share-person")).toHaveTextContent("Anna B.");
    expect(screen.getByTestId("share-person")).toHaveAttribute("href", "/u/anna");
    expect(screen.getByTestId("share-download")).toHaveAttribute("download", "achievement-aw1.png");
    fireEvent.click(screen.getByTestId("share-button"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/achievements/a/aw1`));
    expect(toastMock.success).toHaveBeenCalledWith("Link kopiert.");
  });

  it("nutzt Web Share, wenn der Browser es kann", async () => {
    apiMock.get.mockResolvedValue({ data: CARD });
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    renderPage();
    fireEvent.click(await screen.findByTestId("share-button"));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0].text).toBe("Anna B. hat „Spielmacher VII“ (Diamant) bei THE LION SQUAD freigeschaltet.");
    expect(toastMock.success).not.toHaveBeenCalled();
    delete navigator.share;
  });

  it("zeigt bei 404 den Hinweis „nicht öffentlich“", async () => {
    apiMock.get.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByTestId("share-private")).toHaveTextContent("Dieser Erfolg ist nicht öffentlich");
    expect(screen.queryByTestId("share-card")).toBeNull();
  });
});
