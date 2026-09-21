import { Share2 } from "lucide-react";

// Link-Vorschau beim Teilen (#347). Für öffentliche Inhalte zeigt WhatsApp & Co. Titel und
// Bild ohnehin. Für Inhalte nur für Mitglieder gibt es sonst nur eine neutrale Karte –
// dieser Haken erlaubt Titel, Datum und Bild für genau diesen Eintrag. Für Internes
// (nur Vorstand) gibt es ihn nicht.

export function sharePreviewHint(visibility, checked) {
  if (visibility === "public" || !visibility) return "Öffentlich: Beim Teilen erscheinen Titel, Beschreibung und Bild.";
  if (visibility === "internal") return "Intern: Beim Teilen erscheint nur eine neutrale Karte mit dem Vereinsbild – nie Titel oder Bild.";
  return checked
    ? "Beim Teilen erscheinen Titel, Datum und Bild. Der Inhalt selbst bleibt hinter der Anmeldung."
    : "Beim Teilen erscheint nur eine neutrale Karte („nur für Mitglieder“) mit dem Vereinsbild.";
}

export function SharePreviewToggle({ visibility, checked, onChange }) {
  const selectable = visibility === "members" || visibility === "community";
  return (
    <div className="border border-white/10 rounded-sm p-3 space-y-2" data-testid="share-preview">
      <div className="text-xs font-bold uppercase tracking-widest text-white/60 inline-flex items-center gap-2"><Share2 className="w-3.5 h-3.5" /> Vorschau beim Teilen (WhatsApp, Discord …)</div>
      {selectable && (
        <label className="flex items-center gap-2 text-sm" htmlFor="share-preview-toggle">
          <input id="share-preview-toggle" type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} data-testid="share-preview-toggle" className="accent-[#29B6E8]" />
          <span>Beim Teilen Titel und Bild zeigen</span>
        </label>
      )}
      <p className="text-xs text-white/50" data-testid="share-preview-hint">{sharePreviewHint(visibility, selectable && checked)}</p>
    </div>
  );
}
