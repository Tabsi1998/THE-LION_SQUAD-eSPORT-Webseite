import { useEffect } from "react";

// Ein Blatt der Ausrüstung (#2218) meldet „ungespeichert“ an die Spielseite: solange es mit Änderungen offen ist, true - beim Schließen
// (Speichern oder Abbrechen) wieder false. Die Spielseite zeigt dann den Punkt am Reiter und fragt beim Verlassen.
export function useReportDirty(dirty, onDirtyChange) {
  useEffect(() => {
    onDirtyChange?.(Boolean(dirty));
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
}
