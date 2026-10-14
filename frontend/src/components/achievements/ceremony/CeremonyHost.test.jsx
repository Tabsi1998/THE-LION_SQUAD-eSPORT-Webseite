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

// Sieger-Moment (#1180): der Turnier-Platz läuft über denselben Host - eigene Karte, Teilen und Turnierbaum.
describe("CeremonyHost: Turnier-Platz", () => {
  const placement = {
    key: "t1:r1", rank: 1, metal: "gold", title: "Champion", label: "Platz 1", name: "NeonFalke", team: false,
    tournamentId: "t1", tournamentTitle: "Lions Smash Finale", tournamentPath: "/tournaments/smash-finale",
  };

  it("zeigt die Karte mit Platz, Name und Turnier; Schließen geht zum Nächsten", async () => {
    authState.user = { id: "u1", ceremony_mode: "full" };
    const user = (await import("@testing-library/user-event")).default.setup();
    const queue = createCeremonyQueue({ now: () => 1 });
    renderHost(queue);
    act(() => { queue.enqueue({ id: "platz", placement }); queue.enqueue({ id: "erfolg", tiers: [tier("a")] }); });
    const card = screen.getByTestId("placement-moment");
    expect(card).toHaveAttribute("data-metal", "gold");
    expect(card).toHaveTextContent("Champion");
    expect(card).toHaveTextContent("NeonFalke");
    expect(card).toHaveTextContent("Lions Smash Finale");
    expect(screen.getByRole("link", { name: /Turnierbaum/ })).toHaveAttribute("href", "/tournaments/smash-finale/bracket");
    expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("placement-moment")).toBeNull());
    expect(screen.getByTestId("achievement-unlock-overlay")).toBeInTheDocument();
  });

  it("„dezent“ bzw. Bewegung reduzieren: dieselbe Karte, ohne Bewegung", () => {
    authState.user = { id: "u1", ceremony_mode: "subtle" };
    const queue = createCeremonyQueue({ now: () => 1 });
    queue.enqueue({ id: "platz", placement: { ...placement, rank: 3, metal: "bronze", title: "Dritter Platz", team: true } });
    renderHost(queue);
    const card = screen.getByTestId("placement-moment");
    expect(card).toHaveAttribute("data-reduced", "true");
    expect(card).toHaveAttribute("data-metal", "bronze");
    expect(card).toHaveTextContent("Dritter Platz");
    expect(card).toHaveTextContent("mit deinem Team");
  });
});
