import { FieldLabel } from "@/components/tls/FormFields";
import { X } from "lucide-react";

// Gelernte Schreibweisen aus Ergebnis-Bildern (#2012): so stand ein Name bzw. Team im Bild, bevor der Vorstand ihn im
// Ergebnis-Blatt korrigiert hat – die Bild-Erkennung erkennt ihn daran wieder. Hier nur entfernen; gespeichert wird mit
// dem Formular (die bleibenden gehen mit). `items`: [{key, label}], `removed`: wie viele schon entfernt sind.

export function LearnedSpellings({ items, removed = 0, onRemove, hint, testId }) {
  if (!items.length && !removed) return null;
  return (
    <FieldLabel label="Aus Bildern gelernt" hint={hint}>
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" data-testid={testId}>
          {items.map((item) => (
            <li key={item.key} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 min-h-[32px] border border-white/10 rounded-sm text-xs text-white/85">
              {item.label}
              <button type="button" onClick={() => onRemove(item.key)} aria-label={`„${item.key}“ entfernen`}
                className="tls-hit p-1 text-white/40 hover:text-white"><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {removed > 0 && (
        <p className="mt-1 text-xs text-amber-200" data-testid={testId ? `${testId}-removed` : undefined}>
          {removed === 1 ? "1 Schreibweise wird" : `${removed} Schreibweisen werden`} beim Speichern entfernt.
        </p>
      )}
    </FieldLabel>
  );
}
