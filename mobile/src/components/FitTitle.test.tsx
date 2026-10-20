import React from "react";
import { render, screen } from "@testing-library/react-native";
import { FitTitle } from "./FitTitle";
import { HeroTitle } from "../screens/main/DashboardScreen";

// Umbruch nur zwischen Wörtern (#1867): jeder FitTitle bricht ohne Silbentrennung und mit der einfachen Strategie -
// als Vorgabe in der Komponente, damit auch die Begrüßung der Startseite auf Android nicht trennt.
test("FitTitle bricht von sich aus einfach und ohne Silbentrennung", async () => {
  await render(<FitTitle text="Regenbogen-Boulevard" minScale={0.8} testID="fit" />);
  const title = screen.getByTestId("fit");
  expect(title.props.textBreakStrategy).toBe("simple");
  expect(title.props.android_hyphenationFrequency).toBe("none");
});

test("die Begrüßung der Startseite erbt die Vorgabe", async () => {
  await render(<HeroTitle text="Willkommen" />);
  const title = screen.getByTestId("dashboard-hero-title");
  expect(title.props.textBreakStrategy).toBe("simple");
  expect(title.props.android_hyphenationFrequency).toBe("none");
});
