// Nur der Kern von `qrcode` (reines JavaScript, keine Renderer, kein `fs`): liefert die Matrix,
// die `QrCode.tsx` als Kästchen zeichnet. Der Haupteinstieg des Pakets zöge Node-Bibliotheken nach.
declare module "qrcode/lib/core/qrcode" {
  export type QrMatrix = { size: number; data: Uint8Array | number[]; get(row: number, col: number): number };
  export function create(data: string, options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): { modules: QrMatrix; version: number };
}
