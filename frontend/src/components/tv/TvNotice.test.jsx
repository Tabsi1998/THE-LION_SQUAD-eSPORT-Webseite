import { render, screen } from "@testing-library/react";
import { TvNoticeBand } from "./TvNotice";

// Hinweis am TV (#1166): nur mit TV-Haken, solange er steht, mit Uhrzeit und Restzeit - an der Hallen-Tafel mit Turnier.

const NOW = Date.parse("2026-11-14T13:07:00Z");
const notice = (id, text, extra = {}) => ({
  id, text, created_at: "2026-11-14T13:00:00Z", expires_at: "2026-11-14T15:00:00Z", target: "tournament", tv: true, ...extra,
});

beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

it("zeigt nur stehende Hinweise mit TV-Haken", () => {
  render(<TvNoticeBand items={[
    notice("a", "Pause bis 14:30"),
    notice("b", "Nur im Web", { tv: false }),
    notice("c", "Vorbei", { expires_at: "2026-11-14T13:00:00Z" }),
  ]} />);
  expect(screen.getAllByTestId("tv-notice-text").map((node) => node.textContent)).toEqual(["Pause bis 14:30"]);
  expect(screen.getByTestId("tv-notice-time").textContent).toBe("14:00 Uhrnoch 1 Std. 53 Min.");
});

it("nennt an der Hallen-Tafel das Turnier und bleibt ohne Hinweis leer", () => {
  const { container, rerender } = render(<TvNoticeBand showTournament items={[notice("a", "Finale an PC 1", { tournament_title: "Kart-Cup" })]} />);
  expect(screen.getByText(/Hinweis der Turnierleitung · Kart-Cup/)).toBeInTheDocument();
  rerender(<TvNoticeBand items={[]} />);
  expect(container).toBeEmptyDOMElement();
});
