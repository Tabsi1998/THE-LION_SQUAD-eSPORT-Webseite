import React from "react";
import { render } from "@testing-library/react-native";
import { PlatformIcon, X_ICON_NAME } from "./PlatformIcon";
import { platformIcon } from "./LinkedAccounts";
import { socialIcon } from "../screens/main/VereinScreen";

// X statt Twitter: der alte Vogel (Ionicons „logo-twitter“) kommt nirgends mehr vor.
test("X und das alte Twitter-Kürzel zeigen das X-Logo", () => {
  expect(platformIcon("x")).toBe(X_ICON_NAME);
  expect(socialIcon("x")).toBe(X_ICON_NAME);
  expect(socialIcon("twitter")).toBe(X_ICON_NAME);
});

test("PlatformIcon: X als FontAwesome-6-Symbol, alles andere als Ionicons", async () => {
  const x = (await render(<PlatformIcon name={X_ICON_NAME} color="#fff" size={20} />)).toJSON();
  const other = (await render(<PlatformIcon name="logo-discord" color="#fff" size={20} />)).toJSON();
  expect(JSON.stringify(x)).not.toContain("logo-twitter");
  expect(JSON.stringify(x)).toContain("FontAwesome6Brands");
  expect(JSON.stringify(other)).not.toBe(JSON.stringify(x));
});
