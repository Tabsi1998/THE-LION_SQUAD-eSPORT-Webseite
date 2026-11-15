import { act, render, screen } from "@testing-library/react";

// Zeremonien bei Bedarf (#936): Der Host wird erst geladen, wenn die Warteschlange etwas zeigt - vorher nicht.

const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock("./CeremonyHost", () => {
  loaded.count += 1;
  return { CeremonyHost: ({ queue }) => <div data-testid="ceremony-host-stub">{queue.getCurrent()?.id}</div> };
});

const { CeremonySlot } = await import("./CeremonySlot");
const { createCeremonyQueue } = await import("./queue");

const tier = (code) => ({ code, name: code, material: "gold", rank: 5, category: "match", points: 10 });

test("lädt den Host erst mit der ersten Zeremonie und behält ihn danach", async () => {
  const queue = createCeremonyQueue({ now: () => 1 });
  render(<CeremonySlot queue={queue} />);
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
  expect(loaded.count).toBe(0);
  expect(screen.queryByTestId("ceremony-host-stub")).toBeNull();

  act(() => { queue.enqueue({ id: "eins", tiers: [tier("a")] }); });
  expect(await screen.findByTestId("ceremony-host-stub")).toHaveTextContent("eins");
  expect(loaded.count).toBe(1);

  act(() => { queue.advance(); });
  // Leer heißt nicht wieder abbauen: der Host blendet selbst aus (AnimatePresence) und wartet auf die nächste.
  expect(screen.getByTestId("ceremony-host-stub")).toBeInTheDocument();
});

test("steht beim Start schon etwas in der Warteschlange, kommt der Host sofort", async () => {
  const queue = createCeremonyQueue({ now: () => 1 });
  queue.enqueue({ id: "frueh", tiers: [tier("b")] });
  render(<CeremonySlot queue={queue} />);
  expect(await screen.findByTestId("ceremony-host-stub")).toHaveTextContent("frueh");
});
