import type React from "react";
import { act, render, screen, waitFor } from "@testing-library/react-native";

// Gemeinsamer Ablauf für die Detail-Screens (#1000): erst Kennung „alt“ öffnen (die Antwort hängt), dann die neue
// Kennung - deren Inhalt erscheint. Kommt danach die Antwort für „alt“, bleibt der neue Inhalt stehen.

type Get = jest.Mock;

export async function expectLateAnswerDiscarded({
  mockGet,
  renderFor,
  newId,
  oldPrefix,
  latePath = oldPrefix,
  oldAnswer,
  newText,
  oldText,
}: {
  /** Der Mock von `api.get` mit der Antwort für die neue Kennung als aktueller Implementierung. */
  mockGet: Get;
  renderFor: (id: string) => React.ReactElement;
  newId: string;
  /** Pfadanfang der Abrufe für die alte Kennung „alt“, etwa „/events/alt“. */
  oldPrefix: string;
  /** Der Abruf für die alte Kennung, der hängt (Standard: `oldPrefix`); die übrigen alten Abrufe antworten sofort. */
  latePath?: string;
  /** Was der Server für die alte Kennung liefert - je Pfad. */
  oldAnswer: (path: string) => unknown;
  newText: string;
  oldText: string;
}) {
  const base = mockGet.getMockImplementation() as (...args: unknown[]) => unknown;
  const pending: Array<() => void> = [];
  mockGet.mockImplementation((path: string, ...rest: unknown[]) => (
    path === latePath
      ? new Promise((resolve) => { pending.push(() => resolve({ data: oldAnswer(path) })); })
      : path.startsWith(oldPrefix)
        ? Promise.resolve({ data: oldAnswer(path) })
        : base(path, ...rest)
  ));
  const view = await render(renderFor("alt"));
  await view.rerender(renderFor(newId));
  await waitFor(() => expect(screen.getAllByText(newText).length).toBeGreaterThan(0));
  expect(pending.length).toBeGreaterThan(0);
  await act(async () => {
    pending.forEach((finish) => finish());
  });
  expect(screen.getAllByText(newText).length).toBeGreaterThan(0);
  expect(screen.queryAllByText(oldText)).toHaveLength(0);
}
