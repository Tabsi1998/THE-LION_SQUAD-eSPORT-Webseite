import React, { useState } from "react";
import { Alert } from "react-native";
import { Button } from "./Button";
import type { CalendarItem } from "../lib/calendar";
import { addToDeviceCalendar } from "../lib/deviceCalendar";

// „In meinen Kalender“ (#216) an Event, Turnier und Fast Lap.

export function AddToCalendarButton({ item, variant = "secondary" }: { item: CalendarItem | null; variant?: "primary" | "secondary" }) {
  const [busy, setBusy] = useState(false);
  if (!item?.start) return null;
  const press = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await addToDeviceCalendar(item);
      if (result.via === "device") Alert.alert("Eingetragen", `„${item.title}“ steht jetzt in deinem Kalender.`);
      if (result.via === "none") Alert.alert("Kein Termin", "Für diesen Eintrag gibt es noch keine Zeit.");
    } catch {
      Alert.alert("Das hat nicht geklappt", "Der Termin konnte nicht eingetragen werden.");
    } finally {
      setBusy(false);
    }
  };
  return <Button label={busy ? "Trage ein ..." : "In meinen Kalender"} variant={variant} onPress={press} disabled={busy} testID="add-to-calendar" />;
}
