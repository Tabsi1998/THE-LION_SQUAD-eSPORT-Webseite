import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original()), api: apiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SquadKaderSheet } from "./SquadKaderSheet";

const SQUAD = {
  registration_id: "r1", team_id: "t1", squad_id: "s1", display_name: "Löwen · Rudel A", squad_status: "active",
  captain_id: "a", vice_captain_id: null, member_ids: ["a", "b", "c"], min_squad_size: 3,
  team_members: [{ id: "a", name: "Anna" }, { id: "b", name: "Bert" }, { id: "c", name: "Clara" }, { id: "d", name: "Dora" }],
};

beforeEach(() => {
  apiMock.patch.mockReset();
  apiMock.patch.mockResolvedValue({ data: {} });
});

test("nur Geändertes geht an den Server", async () => {
  const saved = vi.fn();
  render(<SquadKaderSheet squad={SQUAD} onClose={() => {}} onSaved={saved} />);
  fireEvent.click(screen.getByTestId("kader-member-d"));
  fireEvent.change(screen.getByTestId("kader-vice_captain_id"), { target: { value: "b" } });
  fireEvent.click(screen.getByTestId("kader-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/teams/t1/squads/s1", { member_ids: ["a", "b", "c", "d"], vice_captain_id: "b" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
});

test("wer eine Rolle hat, bleibt im Kader", () => {
  render(<SquadKaderSheet squad={SQUAD} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("kader-member-a")).toBeDisabled();
  expect(screen.getByTestId("kader-member-b")).not.toBeDisabled();
});

test("unter der Mindestgröße warnt das Blatt, speichern bleibt möglich", async () => {
  render(<SquadKaderSheet squad={SQUAD} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.queryByTestId("kader-short")).toBeNull();
  fireEvent.click(screen.getByTestId("kader-member-c"));
  expect(screen.getByTestId("kader-short")).toHaveTextContent("mindestens 3");
  fireEvent.click(screen.getByTestId("kader-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/teams/t1/squads/s1", { member_ids: ["a", "b"] }));
});

test("den Status ändern und ohne Änderung nichts schicken", async () => {
  const closed = vi.fn();
  render(<SquadKaderSheet squad={SQUAD} onClose={closed} onSaved={() => {}} />);
  fireEvent.click(screen.getByTestId("kader-save"));
  await waitFor(() => expect(closed).toHaveBeenCalled());
  expect(apiMock.patch).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("kader-status"), { target: { value: "archived" } });
  fireEvent.click(screen.getByTestId("kader-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/teams/t1/squads/s1", { status: "archived" }));
});

test("sagt der Server nein, bleibt das Blatt offen mit seinem Satz", async () => {
  apiMock.patch.mockRejectedValue({ response: { data: { detail: "Das Co-Team spielt in Staffel A." } } });
  const saved = vi.fn();
  render(<SquadKaderSheet squad={SQUAD} onClose={() => {}} onSaved={saved} />);
  fireEvent.click(screen.getByTestId("kader-member-d"));
  fireEvent.click(screen.getByTestId("kader-save"));
  expect(await screen.findByTestId("kader-error")).toHaveTextContent("spielt in Staffel A");
  expect(saved).not.toHaveBeenCalled();
});
