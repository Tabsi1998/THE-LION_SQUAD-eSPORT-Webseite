import { useEffect, useRef, useState } from "react";
import { Download, Link2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { resolveMediaUrl } from "@/lib/api";
import { copyResultLink, loadResultImage, prefersShareSheet, shareResultImage } from "@/lib/resultShare";

// Teilen-Bild einer Belohnung (F.4, #2214, Nr. 165): am Handy Bild und Link ins Teilen-Menü, am PC „Bild herunterladen“ und „Link
// kopieren“ - wie „Ergebnis teilen“ (ResultShareButton). Das Bild zeichnet der Server (/api/rewards/<id>/share.png) und nur, wenn die
// Belohnung öffentlich sichtbar ist.

export function rewardImagePath(award) {
  return `/api/rewards/${encodeURIComponent(award.id)}/share.png`;
}

export function rewardFileName(award) {
  const name = String(award?.reward?.name || "belohnung").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${name || "belohnung"}.png`;
}

/** Lässt sich die Belohnung teilen? Eine der Gesamtwertung (F.5) ohne öffentlichen Link nicht - es gäbe keine Seite, auf die der Link
 *  führt (keine Season des Zeitraums ist öffentlich). */
export function canShareReward(award) {
  return !(String(award?.tournament?.id || "").startsWith("overall:") && !award?.url);
}

export function rewardShareLink(award, origin = typeof window === "undefined" ? "" : window.location.origin) {
  // Gesamtwertung (F.5, #2215): keine Staffel dahinter - der Server nennt die Ligaseite der Gesamtwertung.
  if (award?.url) return `${origin}${award.url}`;
  const slug = award?.tournament?.slug || award?.tournament?.id;
  return slug ? `${origin}/tournaments/${encodeURIComponent(slug)}` : origin;
}

export function RewardShareButton({ award, nav = typeof navigator !== "undefined" ? navigator : null, testId = "reward-share" }) {
  const [mobile] = useState(() => prefersShareSheet(nav));
  const fileRef = useRef(null);
  const image = resolveMediaUrl(rewardImagePath(award));
  useEffect(() => {
    if (!mobile) return undefined;
    let alive = true;
    loadResultImage(image, rewardFileName(award)).then((file) => { if (alive) fileRef.current = file; });
    return () => { alive = false; };
  }, [mobile, image, award]);
  if (!canShareReward(award)) return null;
  const url = rewardShareLink(award);
  const text = [award?.reward?.name, award?.reward?.art?.season, award?.reward?.art?.division, "THE LION SQUAD"].filter(Boolean).join(" · ");
  const button = "tls-btn inline-flex min-h-[44px] items-center justify-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-widest rounded-sm";
  if (mobile) {
    const share = async () => {
      const result = await shareResultImage({ file: fileRef.current, url, text, title: award?.reward?.name, nav });
      if (result.status === "failed") toast.error("Teilen ging nicht – lade das Bild herunter oder kopiere den Link.");
    };
    return (
      <button type="button" onClick={share} className={`${button} tls-btn--secondary`} data-testid={`${testId}-share`}>
        <Share2 className="w-3.5 h-3.5" aria-hidden="true" /> Teilen
      </button>
    );
  }
  const copy = async () => {
    const result = await copyResultLink(url, nav);
    if (result.status === "copied") toast.success("Link kopiert.");
    else toast.error("Kopieren ging nicht.");
  };
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-2" data-testid={testId}>
      <a href={image} download={rewardFileName(award)} className={`${button} tls-btn--secondary`} data-testid={`${testId}-download`}>
        <Download className="w-3.5 h-3.5" aria-hidden="true" /> Bild herunterladen
      </a>
      <button type="button" onClick={copy} className={`${button} tls-btn--quiet`} data-testid={`${testId}-copy`}>
        <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Link kopieren
      </button>
    </span>
  );
}
