import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Kronen-Feier (#936): Der Hörer ist sofort da, die Feier mit Kronen-Grafik lädt erst mit dem ersten Ereignis.

const crowns = vi.hoisted(() => ({ loaded: 0, refresh: vi.fn(() => Promise.resolve({})) }));
vi.mock("./LevelAvatarFrame", () => {
  crowns.loaded += 1;
  return {
    CrownIcon: ({ variant }) => <span data-testid="crown-icon">{variant}</span>,
    CROWN_LABELS: { gold: "Platz 1 der Punktewertung" },
    refreshCrowns: crowns.refresh,
  };
});

const { CrownCelebration } = await import("./CrownCelebration");

const celebrate = (detail) => act(() => { window.dispatchEvent(new CustomEvent("tls-crown-celebration", { detail })); });

test("lädt die Feier erst mit dem Ereignis und zeigt Krone und Text", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><CrownCelebration /></MemoryRouter>);
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
  expect(crowns.loaded).toBe(0);
  expect(screen.queryByTestId("crown-celebration-overlay")).toBeNull();

  celebrate({ id: "n1", variant: "silver", body: "Neu in den Top 3" });
  expect(await screen.findByTestId("crown-celebration-overlay")).toBeInTheDocument();
  expect(crowns.loaded).toBe(1);
  expect(crowns.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("crown-celebration-title")).toHaveTextContent("SILBER-KRONE EROBERT!");
  expect(screen.getByTestId("crown-celebration-body")).toHaveTextContent("Neu in den Top 3");
  expect(screen.getByTestId("crown-icon")).toHaveTextContent("silver");

  await user.click(screen.getByTestId("crown-celebration-close"));
  expect(screen.queryByTestId("crown-celebration-overlay")).toBeNull();
});

test("die Onyx-Krone ist erreicht, nicht erobert (#2501)", async () => {
  render(<MemoryRouter><CrownCelebration /></MemoryRouter>);
  celebrate({ id: "n3", variant: "onyx", body: "Du trägst jetzt die Onyx-Krone." });
  expect(await screen.findByTestId("crown-celebration-title")).toHaveTextContent("ONYX-KRONE ERREICHT!");
  expect(screen.getByTestId("crown-icon")).toHaveTextContent("onyx");
});

test("Escape schließt, ohne Text steht die Beschreibung der Krone", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><CrownCelebration /></MemoryRouter>);
  celebrate({ id: "n2" });
  expect(await screen.findByTestId("crown-celebration-body")).toHaveTextContent("Platz 1 der Punktewertung");
  expect(screen.getByTestId("crown-celebration-title")).toHaveTextContent("GOLD-KRONE EROBERT!");
  await user.keyboard("{Escape}");
  expect(screen.queryByTestId("crown-celebration-overlay")).toBeNull();
});
