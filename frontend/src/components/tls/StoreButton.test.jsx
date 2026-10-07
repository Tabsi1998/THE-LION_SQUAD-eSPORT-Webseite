import { render, screen } from "@testing-library/react";
import { STORE_VARIANT, StoreButton } from "./StoreButton";

// Download-Knopf (#1084): nur mit Play-Link, zwei Zeilen, die Variante steht als Klasse am Knopf.

test("ohne Play-Link gibt es keinen Knopf", () => {
  const { container } = render(<StoreButton href={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("mit Link: zwei Zeilen, neuer Tab, Vorgabe-Variante als Klasse", () => {
  render(<StoreButton href="https://play.google.com/store/apps/details?id=at.lionsquad.app" />);
  const link = screen.getByTestId("store-button");
  expect(link).toHaveAttribute("href", "https://play.google.com/store/apps/details?id=at.lionsquad.app");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noreferrer");
  expect(link).toHaveClass("tls-store", `tls-store--${STORE_VARIANT}`);
  expect(link).toHaveAttribute("data-variant", STORE_VARIANT);
  expect(link).toHaveTextContent("Jetzt bei");
  expect(link).toHaveTextContent("Google Play");
  expect(link.querySelector("svg")).not.toBeNull();
});

test("Variante c trägt die App-Kachel statt des Symbols", () => {
  render(<StoreButton href="https://play.google.com/x" variant="c" small="LionsAPP für Android" big="Bei Google Play laden" />);
  const link = screen.getByTestId("store-button");
  expect(link).toHaveClass("tls-store--c");
  expect(link.querySelector(".tls-store__tile")).toHaveTextContent("TLS");
  expect(link.querySelector("svg")).toBeNull();
  expect(link).toHaveAccessibleName("LionsAPP für Android Bei Google Play laden");
});

test("App Store (#1084): eigenes neutrales Symbol und eigene Zeilen", () => {
  render(<StoreButton href="https://apps.apple.com/at/app/lionsapp/id123" small="Laden im" big="App Store" icon="phone" testId="appstore" />);
  const link = screen.getByTestId("appstore");
  expect(link).toHaveTextContent("Laden im");
  expect(link).toHaveTextContent("App Store");
  expect(link.querySelector("svg")).toHaveAttribute("data-icon", "phone");
  expect(link).toHaveAccessibleName("Laden im App Store");
});
