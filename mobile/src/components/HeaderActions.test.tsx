import React from "react";
import { Share, Text } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// „Teilen“ oben rechts (#1154): der Kopf einer Detailseite bekommt den Knopf vor der Glocke, sobald es etwas zu teilen
// gibt; im News-Beitrag geht Satz und Adresse ins Teilen-Menü.

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (value: string) => value,
}));

const { HeaderActions, useShareHeader } = require("./HeaderActions");

test("der Knopf steht im Kopf, hat einen Namen für den Vorleser und teilt", async () => {
  const onShare = jest.fn();
  await render(<HeaderActions onShare={onShare} />);
  const button = screen.getByTestId("header-share");
  expect(button.props.accessibilityLabel).toBe("Teilen");
  await fireEvent.press(button);
  expect(onShare).toHaveBeenCalledTimes(1);
});

test("ohne etwas zum Teilen nur die Glocke (für Gäste nichts)", async () => {
  await render(<HeaderActions onShare={null} />);
  expect(screen.queryByTestId("header-share")).toBeNull();
});

test("useShareHeader setzt den Kopf, sobald es etwas zu teilen gibt", async () => {
  let headerRight: (() => React.ReactNode) | undefined;
  const navigation = { setOptions: jest.fn((options: { headerRight?: () => React.ReactNode }) => { headerRight = options.headerRight; }) };
  const onShare = jest.fn();
  function Probe({ share }: { share: (() => void) | null }) {
    useShareHeader(navigation, share);
    return <Text>Seite</Text>;
  }
  await render(<Probe share={onShare} />);
  expect(navigation.setOptions).toHaveBeenCalled();
  await screen.unmount();
  await render(<>{headerRight ? headerRight() : null}</>);
  await fireEvent.press(screen.getByTestId("header-share"));
  expect(onShare).toHaveBeenCalledTimes(1);
});

test("News-Beitrag: Teilen schickt Titel, Verein und die Adresse des Beitrags", async () => {
  const { NewsDetailScreen } = require("../screens/main/NewsDetailScreen");
  mockGet.mockResolvedValue({ data: { id: "n1", slug: "saisonfinale", title: "Saisonfinale im Vereinsheim", content: "Am Samstag.", published_at: "2026-10-01T10:00:00Z" } });
  mockPost.mockResolvedValue({ data: {} });
  let headerRight: (() => React.ReactNode) | undefined;
  const navigation = { navigate: jest.fn(), setOptions: jest.fn((options: { headerRight?: () => React.ReactNode }) => { headerRight = options.headerRight; }) };
  const spy = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  await render(<NewsDetailScreen navigation={navigation as never} route={{ key: "n", name: "NewsDetail", params: { id: "saisonfinale" } } as never} />);
  await waitFor(() => expect(screen.getByText("Saisonfinale im Vereinsheim")).toBeTruthy());
  await waitFor(() => expect(headerRight).toBeTruthy());
  await screen.unmount();
  await render(<>{headerRight ? headerRight() : null}</>);
  await fireEvent.press(screen.getByTestId("header-share"));
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/^Saisonfinale im Vereinsheim · THE LION SQUAD\n.*\/news\/saisonfinale$/) }));
  spy.mockRestore();
});
