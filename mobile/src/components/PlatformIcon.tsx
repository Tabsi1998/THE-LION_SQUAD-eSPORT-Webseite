import React from "react";
import { Ionicons } from "@expo/vector-icons";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";

/** Ionicons kennt nur den alten Twitter-Vogel; für X nehmen wir das X-Logo aus FontAwesome 6. */
export const X_ICON_NAME = "logo-x";

export type PlatformIconName = keyof typeof Ionicons.glyphMap | typeof X_ICON_NAME;

/** Symbol einer Plattform: für X das X-Logo, sonst ein Ionicons-Name. */
export function PlatformIcon({
  name,
  color,
  size,
}: {
  name: PlatformIconName;
  color: string;
  size: number;
}) {
  if (name === X_ICON_NAME) return <FontAwesome6 name="x-twitter" color={color} size={size - 2} />;
  return <Ionicons name={name} color={color} size={size} />;
}
