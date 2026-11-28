import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original()), api: apiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeagueDeleteSheet } from "./LeagueDeleteSheet";

const BLOCKED = { kind: "division", id: "d1", name: "Liga 1", deletable: false, archived: false, seasons: [], divisions: [], staffeln: [],
  blockers: ["Probe-Liga Season 2 · Liga 1 · Staffel A hat schon Co-Teams zugeteilt"] };

beforeEach(() => vi.clearAllMocks());

test("Abgesagte Season (#2607): kein „Archivieren“, der Hinweis nennt die Sichtbarkeit „Aus“", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BLOCKED, cancelled: true } });
  render(<LeagueDeleteSheet kind="division" target={{ id: "d1" }} name="Liga 1" onClose={() => {}} onArchive={() => true} />);

  expect(await screen.findByText("Abgesagt – bleibt erhalten")).toBeInTheDocument();
  expect(screen.getByTestId("league-delete-hint")).toHaveTextContent("Sichtbarkeit „Aus“");
  expect(screen.queryByTestId("league-delete-archive")).toBeNull();
});

test("Ohne Absage bleibt „Archivieren statt löschen“ mit Knopf", async () => {
  apiMock.get.mockResolvedValue({ data: BLOCKED });
  render(<LeagueDeleteSheet kind="division" target={{ id: "d1" }} name="Liga 1" onClose={() => {}} onArchive={() => true} />);

  expect(await screen.findByText("Archivieren statt löschen")).toBeInTheDocument();
  expect(screen.getByTestId("league-delete-archive")).toBeInTheDocument();
});
