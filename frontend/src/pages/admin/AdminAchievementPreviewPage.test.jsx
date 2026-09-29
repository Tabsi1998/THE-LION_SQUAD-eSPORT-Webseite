import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin", ceremony_mode: "subtle" } }) }));
vi.mock("@/components/achievements/ceremony/sounds", async (importOriginal) => ({ ...(await importOriginal()), playCeremonySound: vi.fn(() => true) }));

const { default: AdminAchievementPreviewPage } = await import("./AdminAchievementPreviewPage");

describe("AdminAchievementPreviewPage (E8)", () => {
  it("zeigt alle Motive im Material, die Materialreihe und reagiert auf die Schalter", () => {
    render(<MemoryRouter><AdminAchievementPreviewPage /></MemoryRouter>);
    const gallery = screen.getByTestId("preview-gallery");
    expect(within(gallery).getAllByRole("button").length).toBeGreaterThanOrEqual(140);
    expect(screen.getByTestId("preview-count")).toHaveTextContent(/\d+ Motive/);
    const row = screen.getByTestId("preview-material-row");
    expect(within(row).getAllByRole("img")).toHaveLength(9);
    expect(within(row).getByTestId("preview-material-legendary").querySelector("[data-lion-crest]")).not.toBeNull();

    fireEvent.change(screen.getByTestId("preview-material"), { target: { value: "diamond" } });
    expect(within(gallery).getByTestId("preview-motif-stopwatch").querySelector("svg")).toHaveAttribute("data-material", "diamond");
    fireEvent.click(screen.getByTestId("preview-locked"));
    expect(within(gallery).getByTestId("preview-motif-stopwatch").querySelector("svg")).toHaveAttribute("data-locked", "true");
    fireEvent.click(screen.getByTestId("preview-motif-stopwatch"));
    expect(row).toHaveTextContent("„stopwatch“ in jedem Material");
    fireEvent.change(screen.getByTestId("preview-search"), { target: { value: "lion" } });
    expect(screen.getByTestId("preview-count")).toHaveTextContent("3 Motive");
  });

  it("spielt eine Zeremonie aus Material, Kategorie und Ablauf ab", async () => {
    render(<MemoryRouter initialEntries={["/admin/achievements/preview"]}><AdminAchievementPreviewPage /></MemoryRouter>);
    fireEvent.change(screen.getByTestId("ceremony-material"), { target: { value: "legendary" } });
    fireEvent.change(screen.getByTestId("ceremony-category"), { target: { value: "club" } });
    fireEvent.click(screen.getByTestId("ceremony-play"));
    const overlay = screen.getByTestId("achievement-unlock-overlay");
    expect(overlay).toHaveAttribute("data-material", "legendary");
    expect(overlay).toHaveAttribute("data-sequence", "legendary");
    expect(overlay).toHaveAttribute("data-motion", "banner");
    expect(overlay).toHaveAttribute("data-reduced", "true");
    fireEvent.click(screen.getByTestId("achievement-unlock-close"));
    await waitFor(() => expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull());
    fireEvent.change(screen.getByTestId("ceremony-sequence"), { target: { value: "levelup" } });
    fireEvent.click(screen.getByTestId("ceremony-play"));
    expect(screen.getByTestId("achievement-unlock-overlay")).toHaveAttribute("data-sequence", "levelup");
  });
});
