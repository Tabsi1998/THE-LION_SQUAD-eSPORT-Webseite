import { create } from "qrcode/lib/core/qrcode";

// QR-Code als Zeilen aus Strichen (#346): jede Zeile ist eine Liste von [Start, Länge] dunkler
// Kästchen. So braucht ein Code mit 29×29 Feldern ~150 statt 841 Views.

export type QrRun = [start: number, length: number];
export type QrRows = { size: number; rows: QrRun[][] };

export function qrRows(value: string): QrRows {
  const { modules } = create(value, { errorCorrectionLevel: "M" });
  const rows: QrRun[][] = [];
  for (let row = 0; row < modules.size; row += 1) {
    const runs: QrRun[] = [];
    let start = -1;
    for (let col = 0; col <= modules.size; col += 1) {
      const dark = col < modules.size && modules.get(row, col) === 1;
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        runs.push([start, col - start]);
        start = -1;
      }
    }
    rows.push(runs);
  }
  return { size: modules.size, rows };
}
