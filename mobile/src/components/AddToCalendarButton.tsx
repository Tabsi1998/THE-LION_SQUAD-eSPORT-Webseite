import React, { useState } from "react";
import { Alert } from "react-native";
import { Button } from "./Button";
import type { CalendarItem } from "../lib/calendar";
import { addToDeviceCalendar } from "../lib/deviceCalendar";

// „In den Kalender“ (#216, seit #1272 dasselbe Wort wie im Web) an Event, Turnier, Fast Lap, Versammlung und eigener
// Helferschicht. Ein mehrtägiges Event (#884) kommt als ein Eintrag je Tag (`items`); ohne Gerätekalender öffnet
// Google nur den ersten Tag - mehr Fenster wären Spam.

export function AddToCalendarButton({ item, items, variant = "secondary", testID = "add-to-calendar" }: { item: CalendarItem | null; items?: CalendarItem[] | null; variant?: "primary" | "secondary"; testID?: string }) {
  const [busy, setBusy] = useState(false);
  const list = items?.length ? items : item ? [item] : [];
  if (!list.length || !list[0].start) return null;
  const press = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let added = 0;
      for (const entry of list) {
        const result = await addToDeviceCalendar(entry);
        if (result.via === "device") added += 1;
        if (result.via === "google") break;
        if (result.via === "none" && list.length === 1) Alert.alert("Kein Termin", "Für diesen Eintrag gibt es noch keine Zeit.");
      }
      if (added === 1 && list.length === 1) Alert.alert("Eingetragen", `„${list[0].title}“ steht jetzt in deinem Kalender.`);
      if (added > 0 && list.length > 1) Alert.alert("Eingetragen", `${added} von ${list.length} Tagen stehen jetzt in deinem Kalender.`);
    } catch {
      Alert.alert("Das hat nicht geklappt", "Der Termin konnte nicht eingetragen werden.");
    } finally {
      setBusy(false);
    }
  };
  const label = list.length > 1 ? `Alle ${list.length} Tage in den Kalender` : "In den Kalender";
  return <Button label={busy ? "Trage ein ..." : label} variant={variant} onPress={press} disabled={busy} testID={testID} />;
}
