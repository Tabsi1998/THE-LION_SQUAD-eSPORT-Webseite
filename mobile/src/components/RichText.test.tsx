import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { RichText } from "./RichText";

// Inhalt aus News, Chat und Events (#997, #998): ein kaputter Verweis bleibt lesbarer Text und reißt die Ansicht nicht
// mit; ein Verweis auf fremde Herkunft öffnet nie einen Screen der App.

const mockOpenLink = jest.fn();
jest.mock("../lib/openLink", () => ({ openLink: (url: string) => mockOpenLink(url) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("./MediaImage", () => ({ MediaImage: () => null }));
jest.mock("./ContentCard", () => ({ ContentCard: () => null }));

beforeEach(() => jest.clearAllMocks());

test("ungültige Prozentkodierung: kein Absturz beim Zeichnen, der Text bleibt sichtbar (#997)", async () => {
  const onOpenContent = jest.fn();
  const text = ["Vorher", "[[news:%]]", "/news/%", "[[event:%E0%A4%A]]", "Siehe [hier](/news/%C3%28) und weiter", "Nachher"].join("\n\n");
  await render(<RichText text={text} onOpenContent={onOpenContent} />);
  expect(screen.getByText("Vorher")).toBeTruthy();
  expect(screen.getByText("[[news:%]]")).toBeTruthy();
  expect(screen.getByText("/news/%")).toBeTruthy();
  expect(screen.getByText("[[event:%E0%A4%A]]")).toBeTruthy();
  expect(screen.getByText("Nachher")).toBeTruthy();
  // Der Link mit kaputter Kennung ist kein Screen; er geht an den gemeinsamen Link-Weg (der prüft die Herkunft).
  await fireEvent.press(screen.getByText("hier"));
  expect(onOpenContent).not.toHaveBeenCalled();
  expect(mockOpenLink).toHaveBeenCalledWith("/news/%C3%28");
});

test("gültige Verweise öffnen weiter ihren Screen", async () => {
  const onOpenContent = jest.fn();
  await render(<RichText text={"[[news:l%C3%B6wen-cup|Löwen-Cup]]\n\nMehr [im Beitrag](https://lionsquad.at/news/saisonstart)"} onOpenContent={onOpenContent} />);
  await fireEvent.press(screen.getByText("Löwen-Cup"));
  expect(onOpenContent).toHaveBeenLastCalledWith({ type: "news", id: "löwen-cup", label: "Löwen-Cup" });
  await fireEvent.press(screen.getByText("im Beitrag"));
  expect(onOpenContent).toHaveBeenLastCalledWith({ type: "news", id: "saisonstart" });
  expect(mockOpenLink).not.toHaveBeenCalled();
});

test("protokoll-relativer Fremdhost: kein Screen der App, sondern ein Link nach außen (#998)", async () => {
  const onOpenContent = jest.fn();
  await render(<RichText text={"//evil.example/news/external-article\n\nLies [das](//evil.example/news/external-article) und [jenes](//news/external-article)"} onOpenContent={onOpenContent} />);
  // Als eigener Absatz ist er nur Text - kein Verweis-Kasten.
  expect(screen.getByText("//evil.example/news/external-article")).toBeTruthy();
  await fireEvent.press(screen.getByText("das"));
  await fireEvent.press(screen.getByText("jenes"));
  expect(onOpenContent).not.toHaveBeenCalled();
  expect(mockOpenLink).toHaveBeenNthCalledWith(1, "https://evil.example/news/external-article");
  expect(mockOpenLink).toHaveBeenNthCalledWith(2, "https://news/external-article");
});
