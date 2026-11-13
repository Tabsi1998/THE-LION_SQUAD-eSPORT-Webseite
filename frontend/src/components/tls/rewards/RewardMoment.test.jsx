import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createCeremonyQueue } from "@/components/achievements/ceremony/queue";
import { planCeremony } from "@/components/achievements/ceremony/select";

// Zeremonie der Belohnungen (F.4, #2214, Nr. 165): je Staffel ein Paket, vor wartenden Erfolgen, gesehen erst nach dem Schließen.
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "p1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { RewardMoment } = await import("./RewardMoment");
const { RewardWatcher, rewardPackages } = await import("./RewardWatcher");

const award = (id, tournament, name, metal = "gold") => ({ id, tournament: { id: tournament, slug: `probe-${tournament}` }, team: { name: "Nordlicht" },
  reward: { kind: "medal", kind_label: "Medaille", name, art: { season: "Season 1", division: "Liga 1", place: "1. Platz", metal } } });

test("je Staffel ein Paket", () => {
  const packages = rewardPackages([award("a", "t1", "Gold"), award("b", "t2", "Banner"), award("c", "t1", "Titel")]);
  expect(packages.map((rows) => rows.map((row) => row.id))).toEqual([["a", "c"], ["b"]]);
});

test("ein Belohnungs-Paket steht vor wartenden Erfolgen und hat einen eigenen Ablauf", () => {
  const queue = createCeremonyQueue();
  queue.enqueue({ tiers: [{ code: "erfolg", rank: 1 }] });
  queue.enqueue({ tiers: [{ code: "zweiter", rank: 1 }] });
  queue.enqueue({ rewards: [award("a", "t1", "Gold")] });
  queue.advance();
  expect(queue.getCurrent().rewards.map((row) => row.id)).toEqual(["a"]);
  expect(planCeremony(queue.getCurrent())).toMatchObject({ sequence: "reward", particles: 0 });
});

test("die Karte nennt Belohnung, Season und Liga N, mehrere stehen nebeneinander", () => {
  const plan = planCeremony({ rewards: [award("a", "t1", "Goldmedaille"), award("b", "t1", "Season-Banner", "lion")] });
  render(<MemoryRouter><RewardMoment plan={plan} onClose={() => {}} reduced /></MemoryRouter>);
  const moment = screen.getByTestId("reward-moment");
  expect(moment).toHaveAttribute("data-metal", "gold");
  expect(moment).toHaveTextContent("2 neue Belohnungen");
  expect(moment).toHaveTextContent("Goldmedaille · Season-Banner");
  expect(moment).toHaveTextContent("Season 1 · Liga 1 · 1. Platz");
  expect(screen.getByTestId("reward-moment-art-a")).not.toHaveAttribute("data-play");
  expect(screen.getByTestId("reward-moment-collection")).toHaveAttribute("href", "/u/me?tab=awards");
});

test("der Wächter reiht noch nicht gefeierte ein und meldet sie erst nach dem Schließen als gesehen", async () => {
  const queue = createCeremonyQueue();
  const client = {
    get: vi.fn().mockResolvedValue({ data: { rewards: [award("a", "t1", "Gold"), award("b", "t2", "Banner")] } }),
    post: vi.fn().mockResolvedValue({ data: { ok: true } }),
  };
  render(<RewardWatcher queue={queue} client={client} />);
  await waitFor(() => expect(queue.getCurrent()?.rewards?.[0]?.id).toBe("a"));
  expect(client.post).not.toHaveBeenCalled();
  queue.advance();
  expect(client.post).toHaveBeenCalledWith("/me/rewards/seen", { ids: ["a"] });
  expect(queue.getCurrent().rewards[0].id).toBe("b");
});
