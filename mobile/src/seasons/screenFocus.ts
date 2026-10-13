import { useContext, useEffect, useState } from "react";
import { NavigationContext } from "@react-navigation/native";
import { anyOverlayOpen, subscribeQuiet } from "./quiet";

/**
 * Ist der Screen, auf dem die Komponente liegt, gerade im Blick? Tabs bleiben geladen, wenn man woanders hinwechselt -
 * eine Dauer-Bewegung (Flammen, Wiegen) ruht dann, statt unsichtbar Akku zu kosten. Ohne Navigation (Tests): ja.
 * Eigene Datei, damit Deko an Karten (cardDeco.tsx) sie nutzen kann, ohne anchors.tsx im Kreis zu laden.
 */
export function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (navigation ? navigation.isFocused() : true));
  useEffect(() => {
    if (!navigation) return undefined;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener("focus", () => setFocused(true));
    const offBlur = navigation.addListener("blur", () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  return focused;
}

/**
 * Liegt gerade ein Dialog, Sheet oder eine Zeremonie über dem Screen (`useSeasonOverlay`, quiet.ts)? Dann ruht eine
 * Dauer-Bewegung darunter (Löwen-Rang-Signatur im Profil, #1456) - der Screen ist im Fokus, aber verdeckt.
 */
export function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(() => anyOverlayOpen());
  useEffect(() => {
    setOpen(anyOverlayOpen());
    return subscribeQuiet((snapshot) => setOpen(snapshot.overlays.length > 0));
  }, []);
  return open;
}
