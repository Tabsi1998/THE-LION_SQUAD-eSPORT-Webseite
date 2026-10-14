import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Turnierbaum-Seite (#1561): nach einer Neuverbindung holt der nächste Stand Verpasstes nach - ohne Bewegung.
const live = { connected: true, load: null };

vi.mock("@/lib/api", () => ({
  resolveMediaUrl: (value) => value,
  api: { get: vi.fn(async (url) => (url.endsWith("/bracket")
    ? { data: { tournament: { id: "t1", slug: "cup", title: "Cup", status: "live" }, matches_v2: [{ id: "m1", slots: [] }], registrations: [], stages: [] } }
    : { data: { id: "t1", slug: "cup", title: "Cup" } })) },
}));
vi.mock("@/hooks/useLiveRefresh", () => ({
  useLiveRefresh: (load) => { live.load = load; return live.connected; },
}));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/BracketTree", () => ({
  BracketTree: (props) => { return <div data-testid="tree" data-quiet={props.quietUpdate ? "1" : "0"} />; },
}));

const { default: TournamentBracketPage } = await import("./TournamentBracketPage");

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tournaments/cup/bracket"]}>
      <Routes><Route path="/tournaments/:slug/bracket" element={<TournamentBracketPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe("TournamentBracketPage", () => {
  it("lädt nach einer Neuverbindung einmal ruhig nach, danach wieder mit Bewegung", async () => {
    const view = renderPage();
    expect(await screen.findByTestId("tree")).toHaveAttribute("data-quiet", "0");
    live.connected = false;
    view.rerender(
      <MemoryRouter initialEntries={["/tournaments/cup/bracket"]}>
        <Routes><Route path="/tournaments/:slug/bracket" element={<TournamentBracketPage />} /></Routes>
      </MemoryRouter>,
    );
    live.connected = true;
    view.rerender(
      <MemoryRouter initialEntries={["/tournaments/cup/bracket"]}>
        <Routes><Route path="/tournaments/:slug/bracket" element={<TournamentBracketPage />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => { await live.load(); });
    expect(screen.getByTestId("tree")).toHaveAttribute("data-quiet", "1");
    await act(async () => { await live.load(); });
    expect(screen.getByTestId("tree")).toHaveAttribute("data-quiet", "0");
  });
});
