// Löwen-Rang (#1457): die 12 Rahmen in drei Breiten (mobile/assets/loewen-rang, von scripts/loewen_rang_assets.py).
// Metro braucht feste `require`-Pfade - deshalb die ausgeschriebene Tabelle.
import type { ImageSourcePropType } from "react-native";
import type { FrameWidth } from "../lib/loewenRang";

/* eslint-disable @typescript-eslint/no-require-imports */
const IMAGES: Record<string, Record<FrameWidth, ImageSourcePropType>> = {
  "01": { 160: require("../../assets/loewen-rang/rang-01-160.webp"), 320: require("../../assets/loewen-rang/rang-01-320.webp"), 640: require("../../assets/loewen-rang/rang-01-640.webp") },
  "02": { 160: require("../../assets/loewen-rang/rang-02-160.webp"), 320: require("../../assets/loewen-rang/rang-02-320.webp"), 640: require("../../assets/loewen-rang/rang-02-640.webp") },
  "03": { 160: require("../../assets/loewen-rang/rang-03-160.webp"), 320: require("../../assets/loewen-rang/rang-03-320.webp"), 640: require("../../assets/loewen-rang/rang-03-640.webp") },
  "04": { 160: require("../../assets/loewen-rang/rang-04-160.webp"), 320: require("../../assets/loewen-rang/rang-04-320.webp"), 640: require("../../assets/loewen-rang/rang-04-640.webp") },
  "05": { 160: require("../../assets/loewen-rang/rang-05-160.webp"), 320: require("../../assets/loewen-rang/rang-05-320.webp"), 640: require("../../assets/loewen-rang/rang-05-640.webp") },
  "06": { 160: require("../../assets/loewen-rang/rang-06-160.webp"), 320: require("../../assets/loewen-rang/rang-06-320.webp"), 640: require("../../assets/loewen-rang/rang-06-640.webp") },
  "07": { 160: require("../../assets/loewen-rang/rang-07-160.webp"), 320: require("../../assets/loewen-rang/rang-07-320.webp"), 640: require("../../assets/loewen-rang/rang-07-640.webp") },
  "08": { 160: require("../../assets/loewen-rang/rang-08-160.webp"), 320: require("../../assets/loewen-rang/rang-08-320.webp"), 640: require("../../assets/loewen-rang/rang-08-640.webp") },
  "09": { 160: require("../../assets/loewen-rang/rang-09-160.webp"), 320: require("../../assets/loewen-rang/rang-09-320.webp"), 640: require("../../assets/loewen-rang/rang-09-640.webp") },
  "10": { 160: require("../../assets/loewen-rang/rang-10-160.webp"), 320: require("../../assets/loewen-rang/rang-10-320.webp"), 640: require("../../assets/loewen-rang/rang-10-640.webp") },
  "11": { 160: require("../../assets/loewen-rang/rang-11-160.webp"), 320: require("../../assets/loewen-rang/rang-11-320.webp"), 640: require("../../assets/loewen-rang/rang-11-640.webp") },
  "12": { 160: require("../../assets/loewen-rang/rang-12-160.webp"), 320: require("../../assets/loewen-rang/rang-12-320.webp"), 640: require("../../assets/loewen-rang/rang-12-640.webp") },
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Das Bild eines Rahmens in der passenden Breite; unbekannte Ränge zeigen Rang 1. */
export function frameImage(key: string, width: FrameWidth): ImageSourcePropType {
  return (IMAGES[key] || IMAGES["01"])[width];
}

export const FRAME_IMAGE_KEYS = Object.keys(IMAGES);
