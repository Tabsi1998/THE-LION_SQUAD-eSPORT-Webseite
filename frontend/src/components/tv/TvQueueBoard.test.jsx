import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Live-Warteschlange am TV (#1634): wechselt das Spiel an einer Station, gleitet der alte Inhalt weg und der neue herein
// - nur die geänderten Stationen, versetzt. „Bewegung reduzieren“: sofort der neue Stand, kein zweiter Inhalt.

const apiMock = { get: vi.fn(async () => ({ data: { settings: {} } })) };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));

const { TvScreen } = await import("./TvScreen");
const { TvQueueBoard } = await import("./TvQueueBoard");

const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const soon = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();

function station(id, running, next) {
  return { id, name: id.toUpperCase(), status: running ? "busy" : "free", waiting: next ? 1 : 0, running, next };
}
const run = (matchId, minutes = 3, duration = 12) => ({ match_id: matchId, state: "running", names: ["Alpha", "Beta"], open_slots: 0, label: "Runde 1", started_at: ago(minutes), duration_minutes: duration });
const plan = (matchId, state = "queued") => ({ match_id: matchId, state, names: ["Gamma", "Delta"], open_slots: 0, label: "Runde 1", forecast_at: soon(15), report_by: state === "called" ? soon(2) : null });
const view = (stations) => ({ applies: true, stations, matches: {}, summary: null });

function board(queue, query = "") {
  return (
    <MemoryRouter initialEntries={[`/display/bracket/t1${query}`]}>
      <TvScreen>
        <TvQueueBoard queue={queue} />
      </TvScreen>
    </MemoryRouter>
  );
}

test("ohne Warteschlange zeichnet die Tafel nichts", () => {
  const { container } = render(board({ applies: false, stations: [] }));
  expect(container.querySelector("[data-testid='tv-queue-board']")).toBeNull();
});

test("Wechsel: das alte Spiel gleitet weg, das neue herein - nur an der Station, die sich geändert hat", async () => {
  const before = view([station("s1", run("m1"), plan("m2")), station("s2", run("m5"), plan("m6"))]);
  const { rerender } = render(board(before));
  await screen.findByTestId("tv-queue-board");
  // Beim ersten Bild kommen die Stationen nacheinander herein (Versatz je Station).
  const delays = ["s1", "s2"].map((id) => screen.getByTestId(`tv-queue-now-${id}`).querySelector(".tv-queue__swap--in").style.getPropertyValue("--tv-delay"));
  expect(delays).toEqual(["0ms", "80ms"]);

  // An s2 startet das nächste Spiel: m6 läuft jetzt, als Nächstes nichts mehr.
  rerender(board(view([station("s1", run("m1"), plan("m2")), station("s2", run("m6", 0), null)])));
  const now = screen.getByTestId("tv-queue-now-s2");
  expect(now).toHaveAttribute("data-match", "m6");
  expect(screen.getByTestId("tv-queue-now-out-s2")).toBeInTheDocument();
  // Die einzige geänderte Station gleitet ohne Wartezeit - s1 bleibt ruhig stehen, ohne Abschied.
  expect(now.querySelector(".tv-queue__swap--in").style.getPropertyValue("--tv-delay")).toBe("0ms");
  expect(screen.queryByTestId("tv-queue-now-out-s1")).not.toBeInTheDocument();
  // Der alte Inhalt geht nach dem Gleiten ganz.
  await waitFor(() => expect(screen.queryByTestId("tv-queue-now-out-s2")).not.toBeInTheDocument());
});

test("aufgerufen: dieselbe Partie wechselt zu „Aufgerufen“ mit Frist - die Station wird gold", () => {
  const { rerender } = render(board(view([station("s1", null, plan("m2"))])));
  expect(screen.getByTestId("tv-queue-lane-s1")).toHaveAttribute("data-state", "free");
  rerender(board(view([{ ...station("s1", null, plan("m2", "called")), status: "reserved" }])));
  expect(screen.getByTestId("tv-queue-lane-s1")).toHaveAttribute("data-state", "called");
  expect(screen.getByTestId("tv-queue-next-s1")).toHaveAttribute("data-state", "called");
  expect(screen.getByTestId("tv-queue-when-s1")).toHaveTextContent(/Aufgerufen · antreten bis \d{2}:\d{2}/);
});

test("die Spielzeit: gelb ab 80 %, rot mit Überzug in Worten", () => {
  render(board(view([station("s1", run("m1", 10, 12), null), station("s2", run("m2", 15.5, 12), null)])));
  expect(screen.getByTestId("tv-queue-clock-s1")).toHaveAttribute("data-tone", "warn");
  const over = screen.getByTestId("tv-queue-clock-s2");
  expect(over).toHaveAttribute("data-tone", "over");
  expect(over).toHaveTextContent("+3 Min.");
});

test("„Bewegung reduzieren“: sofort der neue Stand - kein weggleitender alter Inhalt", async () => {
  const { rerender } = render(board(view([station("s1", run("m1"), plan("m2"))]), "?reduce_motion=1"));
  await screen.findByTestId("tv-queue-board");
  rerender(board(view([station("s1", run("m2", 0), null)]), "?reduce_motion=1"));
  expect(screen.getByTestId("tv-queue-now-s1")).toHaveAttribute("data-match", "m2");
  expect(screen.queryByTestId("tv-queue-now-out-s1")).not.toBeInTheDocument();
  expect(screen.queryByTestId("tv-queue-next-out-s1")).not.toBeInTheDocument();
});
