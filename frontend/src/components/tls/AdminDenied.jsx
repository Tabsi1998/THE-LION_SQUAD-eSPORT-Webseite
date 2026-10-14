// „Dafür fehlt dir …“ statt einer leeren Liste (#1353): verweigert der Server eine Liste der Verwaltung, sagt die Seite
// das - mit dem Satz des Servers (fehlender Bereich oder Zwei-Faktor-Anmeldung). Dieselbe Regel wie #984 für die
// öffentlichen Listen: ein Ladefehler ist nie „nichts da“.
import { Lock } from "lucide-react";

export function AdminDenied({ text, testId = "admin-denied" }) {
  if (!text) return null;
  return (
    <div role="status" data-testid={testId} className="flex items-start gap-3 rounded-sm border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-white/75">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
