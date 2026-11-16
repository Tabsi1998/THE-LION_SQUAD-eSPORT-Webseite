import React from "react";
import { Text } from "react-native";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { NoticeBanner, useNotices } from "./NoticeBanner";
import type { NoticeItem } from "../../lib/tournamentNotices";

// Hinweis der Turnierleitung (#1166, #2393): das Banner oben auf Turnier- und Event-Seite - nur, was noch steht, der
// neueste zuerst, mit Uhrzeit und Restzeit; abgelaufen verschwindet es von selbst. Nie die Person, die geschrieben hat.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => undefined }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const NOW = new Date("2026-11-14T13:07:00Z"); // 14:07 in Wien
const STANDING: NoticeItem = { id: "a", text: "Pause bis 14:30", created_at: "2026-11-14T13:00:00Z", expires_at: "2026-11-14T15:00:00Z", target: "tournament" };
const SOON: NoticeItem = { id: "b", text: "Finale an PC 1", created_at: "2026-11-14T12:30:00Z", expires_at: "2026-11-14T13:08:00Z", target: "event" };
const GONE: NoticeItem = { id: "c", text: "Bitte zum Check-in", created_at: "2026-11-14T10:00:00Z", expires_at: "2026-11-14T12:00:00Z", target: "tournament" };

afterEach(() => {
  jest.useRealTimers();
});

test("zeigt nur, was noch steht - den neuesten zuerst - mit Uhrzeit und Restzeit", async () => {
  jest.useFakeTimers({ now: NOW });
  await render(<NoticeBanner items={[SOON, GONE, STANDING]} />);
  expect(screen.getByTestId("notice-a")).toBeTruthy();
  expect(screen.getByTestId("notice-b")).toBeTruthy();
  expect(screen.queryByTestId("notice-c")).toBeNull();
  const texts = screen.getAllByTestId("notice-text").map((node) => node.props.children);
  expect(texts).toEqual(["Pause bis 14:30", "Finale an PC 1"]);
  expect(screen.getAllByTestId("notice-meta")[0]).toHaveTextContent("14:00 Uhr · noch 1 Std. 53 Min.");
  expect(screen.getByLabelText("Hinweis der Turnierleitung: Pause bis 14:30. 14:00 Uhr, noch 1 Std. 53 Min.")).toBeTruthy();
});

test("läuft ein Hinweis ab, blendet er aus und verschwindet", async () => {
  jest.useFakeTimers({ now: NOW });
  await render(<NoticeBanner items={[SOON]} />);
  expect(screen.getByTestId("notice-b")).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(61000); });
  expect(screen.queryByTestId("notice-b")).toBeNull();
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(screen.queryByTestId("notice-banner")).toBeNull();
});

test("auf der Event-Seite auf Wunsch mit dem Turniernamen", async () => {
  jest.useFakeTimers({ now: NOW });
  await render(<NoticeBanner items={[{ ...STANDING, tournament_title: "FC 26 Herbst-Cup" }]} showTournament />);
  expect(screen.getByTestId("notice-a")).toHaveTextContent(/HINWEIS DER TURNIERLEITUNG · FC 26 Herbst-Cup/);
});

function Probe({ path }: { path: string | null }) {
  const items = useNotices(path);
  return <Text testID="count">{items.length}</Text>;
}

test("lädt die Hinweise vom Server; ohne Pfad nichts, ein Fehler lässt die Seite ohne Banner", async () => {
  mockGet.mockResolvedValueOnce({ data: { items: [STANDING] } });
  const view = await render(<Probe path="/tournaments/t1/notices" />);
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
  expect(mockGet).toHaveBeenCalledWith("/tournaments/t1/notices");
  await view.unmount();

  mockGet.mockRejectedValueOnce(new Error("weg"));
  await render(<Probe path="/events/herbst-lan/notices" />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/events/herbst-lan/notices"));
  expect(screen.getByTestId("count")).toHaveTextContent("0");

  mockGet.mockClear();
  await render(<Probe path={null} />);
  expect(mockGet).not.toHaveBeenCalled();
});
