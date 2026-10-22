import { ImageUpload } from "@/components/tls/ImageUpload";
import { FieldLabel } from "@/components/tls/FormFields";
import { resolveMediaUrl } from "@/lib/api";

// Logo einer Spur bzw. Saison (#2014): Hochladen über den sicheren Logo-Upload (schneidet leere Ränder ab) oder Wählen
// aus der Mediathek, Entfernen. Darunter die Vorschau auf hellem und dunklem Grund - gezeigt wird das Logo überall
// wie hochgeladen, nie eingefärbt (#1321). Eine beliebige Adresse lässt sich nicht eintragen.

export function SeriesLogoField({ value, onChange, testId, hint, inherited = "" }) {
  const shown = value || inherited;
  return (
    <FieldLabel label="Logo" hint={hint}>
      <ImageUpload value={value} onChange={onChange} testId={testId} variant="square" endpoint="/uploads/logo" allowLibrary />
      {shown && (
        <div className="mt-2 grid grid-cols-2 gap-2" data-testid={`${testId}-surfaces`}>
          <LogoSurface src={shown} light testId={`${testId}-light`} />
          <LogoSurface src={shown} testId={`${testId}-dark`} />
        </div>
      )}
      {!value && inherited && (
        <p className="mt-1.5 text-xs text-white/55" data-testid={`${testId}-inherited`}>Vorschau zeigt das Logo der Spur.</p>
      )}
    </FieldLabel>
  );
}

function LogoSurface({ src, light = false, testId }) {
  return (
    <figure className="m-0 flex flex-col gap-1">
      <div className={`h-20 rounded-sm border flex items-center justify-center p-3 ${light ? "bg-white border-black/10" : "bg-[#0A0A0A] border-white/10"}`} data-testid={testId}>
        <img src={resolveMediaUrl(src)} alt="" className="max-h-full max-w-full object-contain" />
      </div>
      <figcaption className="text-[10px] uppercase tracking-widest font-bold text-white/45">{light ? "Heller Grund" : "Dunkler Grund"}</figcaption>
    </figure>
  );
}
