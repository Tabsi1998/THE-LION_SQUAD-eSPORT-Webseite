import { ImageUpload } from "@/components/tls/ImageUpload";
import { FieldLabel } from "@/components/tls/FormFields";
import { LogoSurfaces } from "@/components/tls/LogoSurfaces";

// Logo einer Spur bzw. Saison (#2014): Hochladen über den sicheren Logo-Upload (schneidet leere Ränder ab, seit #1952
// auch als SVG) oder Wählen aus der Mediathek, Entfernen. Darunter die Vorschau auf hellem und dunklem Grund - auch für
// das geerbte Logo der Spur. Eine beliebige Adresse lässt sich nicht eintragen.

export function SeriesLogoField({ value, onChange, testId, hint, inherited = "" }) {
  const shown = value || inherited;
  return (
    <FieldLabel label="Logo" hint={hint}>
      <ImageUpload value={value} onChange={onChange} testId={testId} variant="square" endpoint="/uploads/logo" allowLibrary logo logoPreview={false} />
      <LogoSurfaces src={shown} testId={testId} />
      {!value && inherited && (
        <p className="mt-1.5 text-xs text-white/55" data-testid={`${testId}-inherited`}>Vorschau zeigt das Logo der Spur.</p>
      )}
    </FieldLabel>
  );
}
