import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Freunde beim Event (#1188): Gäste fragen nicht; die Zeile nennt nur, was der Server schickt; der Hinweis erscheint
// einmal und schaltet auf Wunsch sofort aus.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (u) => u }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { FriendsAtEvent } = await import("./FriendsAtEvent");

const EVENT = { id: "e1", slug: "herbst-lan" };
const FINN = { id: "u-finn", display_name: "Finn", avatar_url: null, username: "finn", where: [{ kind: "event" }, { kind: "tournament", id: "t-rl", title: "Rocket League 2v2", team_name: "Lions Rocket" }] };
const LEA = { id: "u-lea", display_name: "Lea Berger", avatar_url: null, username: null, where: [{ kind: "event" }] };

function renderRow(user, props = {}) {
  return render(<MemoryRouter><FriendsAtEvent event={EVENT} user={user} {...props} /></MemoryRouter>);
}

test("Gäste: keine Abfrage, keine Zeile", () => {
  renderRow(null);
  expect(apiMock.get).not.toHaveBeenCalled();
  expect(screen.queryByTestId("event-friends")).toBeNull();
});

test("Freunde mit Bild-Ersatz, Orten und Teamname; Link aufs Profil nur bei öffentlichem Profil", async () => {
  apiMock.get.mockResolvedValue({ data: { friends: [FINN, LEA], sharing: true, hint: false } });
  renderRow({ id: "u-vera" });
  expect(await screen.findByTestId("event-friends")).toHaveTextContent("Von deinen Freunden dabei");
  expect(apiMock.get).toHaveBeenCalledWith("/events/herbst-lan/friends");
  expect(screen.getByTestId("event-friends-sentence")).toHaveTextContent("Finn und Lea Berger sind dabei.");
  expect(screen.getByTestId("event-friend-u-finn")).toHaveTextContent("Event · Rocket League 2v2 (Lions Rocket)");
  expect(screen.getByRole("link", { name: "Finn" })).toHaveAttribute("href", "/u/finn");
  expect(screen.queryByRole("link", { name: "Lea Berger" })).toBeNull();
  expect(screen.getByTestId("event-friend-u-lea")).toHaveTextContent("LB");
  expect(screen.queryByTestId("event-friends-hint")).toBeNull();
});

test("nach dem Event in der Vergangenheit; ohne Freunde und ohne Hinweis nichts", async () => {
  apiMock.get.mockResolvedValue({ data: { friends: [FINN], sharing: true, hint: false } });
  const { unmount } = renderRow({ id: "u-vera" }, { over: true });
  expect(await screen.findByTestId("event-friends")).toHaveTextContent("Deine Freunde waren dabei");
  unmount();
  apiMock.get.mockResolvedValue({ data: { friends: [], sharing: true, hint: false } });
  renderRow({ id: "u-vera" });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("event-friends")).toBeNull();
});

test("Hinweis einmal: „Verstanden“ bestätigt, „Ausschalten“ schaltet sofort aus", async () => {
  apiMock.get.mockResolvedValue({ data: { friends: [], sharing: true, hint: true } });
  apiMock.post.mockResolvedValue({ data: { sharing: true } });
  const { unmount } = renderRow({ id: "u-vera" });
  expect(await screen.findByTestId("event-friends-hint")).toHaveTextContent("Deine Freunde sehen, zu welchen Events du angemeldet bist.");
  fireEvent.click(screen.getByTestId("event-friends-hint-ok"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/users/me/friends-hint", { turn_off: false }));
  await waitFor(() => expect(screen.queryByTestId("event-friends-hint")).toBeNull());
  unmount();

  apiMock.post.mockResolvedValue({ data: { sharing: false } });
  renderRow({ id: "u-vera" });
  fireEvent.click(await screen.findByTestId("event-friends-hint-off"));
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/users/me/friends-hint", { turn_off: true }));
  await waitFor(() => expect(screen.queryByTestId("event-friends-hint")).toBeNull());
});

test("Turnier- und Fast-Lap-Seite (#1188 Teil 2): eigene Abfrage und Ortsangabe je Seite", async () => {
  apiMock.get.mockResolvedValue({ data: { friends: [{ ...LEA, where: [{ kind: "tournament", id: "t-rl", title: "RL", team_name: "Lions Rocket" }] }], sharing: true, hint: false } });
  const { unmount } = render(<MemoryRouter><FriendsAtEvent user={{ id: "u-vera" }} path="/tournaments/rl/friends" scope="tournament" /></MemoryRouter>);
  expect(await screen.findByTestId("event-friend-u-lea")).toHaveTextContent("mit Lions Rocket");
  expect(apiMock.get).toHaveBeenLastCalledWith("/tournaments/rl/friends");
  unmount();
  apiMock.get.mockResolvedValue({ data: { friends: [{ ...LEA, where: [{ kind: "fastlap", id: "c-monza", title: "Monza" }] }], sharing: true, hint: false } });
  render(<MemoryRouter><FriendsAtEvent user={{ id: "u-vera" }} path="/f1/challenges/monza/friends" scope="fastlap" /></MemoryRouter>);
  expect(await screen.findByTestId("event-friend-u-lea")).toHaveTextContent("Zeit gefahren");
  expect(apiMock.get).toHaveBeenLastCalledWith("/f1/challenges/monza/friends");
});
