import { NativeModule, requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import { Platform } from "react-native";

// Bilder aus der Tastatur (#239): Sticker und GIFs von Samsung-Tastatur und Gboard kommen als Bild ins
// Eingabefeld. Nur Android; auf iOS und ohne das native Modul (Expo Go, Tests) passiert nichts.

export type KeyboardImage = { viewTag: number; uri: string; mimeType: string; fileName: string; fileSize: number };

type Events = { onKeyboardImage: (image: KeyboardImage) => void };
declare class Native extends NativeModule<Events> {
  attach(viewTag: number): Promise<void>;
  detach(viewTag: number): Promise<void>;
}

const native: Native | null = Platform.OS === "android" ? requireOptionalNativeModule<Native>("KeyboardImageInput") : null;

export const keyboardImagesSupported = native !== null;

/** Nimmt für das TextInput mit diesem React-Tag Bilder der Tastatur an; die Rückgabe löst wieder. */
export function acceptKeyboardImages(viewTag: number | null | undefined, onImage: (image: KeyboardImage) => void): () => void {
  if (!native || !viewTag) return () => {};
  const subscription: EventSubscription = native.addListener("onKeyboardImage", (image) => {
    if (image.viewTag === viewTag) onImage(image);
  });
  native.attach(viewTag).catch(() => {});
  return () => {
    subscription.remove();
    native.detach(viewTag).catch(() => {});
  };
}
