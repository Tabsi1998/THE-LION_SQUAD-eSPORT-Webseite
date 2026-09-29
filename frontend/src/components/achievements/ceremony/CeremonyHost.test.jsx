import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Der Host (E8): zeigt die laufende Zeremonie aus der Warteschlange, nie zwei, still im Adminbereich,
// „dezent“ aus dem Profil schaltet auf reduzierte Bewegung.

const authState = { user: { id: "u1", ceremony_mode: "full" } };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useLiveChanges", () => ({ useReducedMotion: () => false }));
vi.mock("./sounds", async (importOriginal) => ({ ...(await importOriginal()), playCeremonySound: vi.fn(() => true) }));

const { CeremonyHost } = await import("./CeremonyHost");
const { createCeremonyQueue } = await import("./queue");

const tier = (code) => ({ code, name: code, material: "gold", rank: 5, category: "match", points: 10 });

function renderHost(queue, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}><CeremonyHost queue={queue} /></MemoryRouter>);
}

describe("CeremonyHost", () => {
  it("zeigt die aktuelle Zeremonie und danach die nächste", async () => {
    const queue = createCeremonyQueue({ now: () => 1 });
    renderHost(queue);
    expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
    act(() => { queue.enqueue({ id: "one", tiers: [tier("a")] }); });
    expect(screen.getByTestId("achievement-unlock-overlay")).toBeInTheDocument();
    expect(screen.getAllByTestId("achievement-unlock-overlay")).toHaveLength(1);
    act(() => { queue.advance(); });
    // AnimatePresence lässt das Overlay bis zum Ende der Ausblendung stehen.
    await waitFor(() => expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull());
  });

  it("bleibt im Adminbereich still und nutzt „dezent“ aus dem Profil", () => {
    const queue = createCeremonyQueue({ now: () => 1 });
    queue.enqueue({ id: "one", tiers: [tier("a")] });
    const { unmount } = renderHost(queue, "/admin/achievements");
    expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
    unmount();
    authState.user = { id: "u1", ceremony_mode: "subtle" };
    renderHost(queue, "/profile");
    expect(screen.getByTestId("achievement-unlock-overlay")).toHaveAttribute("data-reduced", "true");
  });
});
