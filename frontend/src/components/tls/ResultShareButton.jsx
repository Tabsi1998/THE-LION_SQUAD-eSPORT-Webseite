import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Link2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api, resolveMediaUrl } from "@/lib/api";
import { copyResultLink, loadResultImage, prefersShareSheet, resultFileName, resultShareUrl, shareResultImage } from "@/lib/resultShare";

// „Ergebnis teilen“ (#1194) in „Dein Stand“ und im Turnier-Eintrag der Referenzen. Der Server sagt, ob es geht;
// wenn nicht wegen eines privaten Profils oder eines nicht öffentlichen Turniers, steht ein Satz da, warum.
// Im Handy-Browser ein Knopf „Ergebnis teilen“ (Bild + Link ins Teilen-Menü), am PC „Bild herunterladen“
// und „Link kopieren“. „Vorschau“ führt zur Teilen-Seite mit beiden Bildern.
export function ResultShareButton({ tournamentId, options: given = null, showPage = true, nav = typeof navigator !== "undefined" ? navigator : null, testId = "result-share" }) {
  const [options, setOptions] = useState(given);
  const [mobile] = useState(() => prefersShareSheet(nav));
  const fileRef = useRef(null);

  useEffect(() => {
    if (given || !tournamentId) return undefined;
    let alive = true;
    api.get(`/share/result-options/${encodeURIComponent(tournamentId)}`)
      .then(({ data }) => { if (alive) setOptions(data); })
      .catch(() => { if (alive) setOptions(null); });
    return () => { alive = false; };
  }, [tournamentId, given]);

  useEffect(() => {
    if (!mobile || !options?.shareable) return undefined;
    let alive = true;
    loadResultImage(resolveMediaUrl(options.image_paths.story), resultFileName(options.path)).then((file) => { if (alive) fileRef.current = file; });
    return () => { alive = false; };
  }, [mobile, options]);

  if (!options) return null;
  if (!options.shareable) {
    if (!["private_profile", "not_public"].includes(options.reason)) return null;
    return (
      <p className="text-xs text-white/55" data-testid={`${testId}-hint`}>
        {options.text}
        {options.reason === "private_profile" ? <> <Link to="/profile?tab=privacy" className="text-[#29B6E8] hover:underline">Zur Privatsphäre</Link></> : null}
      </p>
    );
  }

  const url = resultShareUrl(options.path);
  const share = async () => {
    const result = await shareResultImage({ file: fileRef.current, url, text: options.share_text, title: options.headline, nav });
    if (result.status === "failed") toast.error("Teilen ging nicht – lade das Bild herunter oder kopiere den Link.");
  };
  const copy = async () => {
    const result = await copyResultLink(url, nav);
    if (result.status === "copied") toast.success("Link kopiert.");
    else toast.error("Kopieren ging nicht – öffne die Vorschau und kopiere die Adresse aus der Leiste.");
  };
  const button = "tls-btn inline-flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-widest rounded-sm";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
      {mobile ? (
        <button type="button" onClick={share} className={`${button} tls-btn--secondary`} data-testid={`${testId}-share`}>
          <Share2 className="w-3.5 h-3.5" /> Ergebnis teilen
        </button>
      ) : (
        <>
          <a href={resolveMediaUrl(options.image_paths.story)} download={resultFileName(options.path)} className={`${button} tls-btn--secondary`} data-testid={`${testId}-download`}>
            <Download className="w-3.5 h-3.5" /> Bild herunterladen
          </a>
          <button type="button" onClick={copy} className={`${button} tls-btn--quiet`} data-testid={`${testId}-copy`}>
            <Link2 className="w-3.5 h-3.5" /> Link kopieren
          </button>
        </>
      )}
      {showPage ? <Link to={options.path} className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] hover:text-white" data-testid={`${testId}-page`}>Vorschau</Link> : null}
    </div>
  );
}

export default ResultShareButton;
