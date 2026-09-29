import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));

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
});
