import { resolveMediaUrl } from "@/lib/api";

// Vorschau eines Logos auf hellem und dunklem Grund - zuerst für das Logo je Spur bzw. Saison (#2014), seit #1952 in
// jedem Logo-Feld. Gezeigt wird das Logo überall wie hochgeladen, nie eingefärbt (#1321); ein SVG nur über <img>.

export function LogoSurfaces({ src, testId }) {
  if (!src) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2" data-testid={`${testId}-surfaces`}>
      <LogoSurface src={src} light testId={`${testId}-light`} />
      <LogoSurface src={src} testId={`${testId}-dark`} />
    </div>
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
