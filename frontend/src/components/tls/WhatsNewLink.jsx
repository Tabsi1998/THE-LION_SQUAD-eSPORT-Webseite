import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { shouldShowDot, whatsNewItems } from "@/lib/whatsNew";
import whatsNew from "@/whatsnew.json";

/**
 * Link „Neu“ in der Fußzeile (#1240): ein kleiner Punkt, wenn seit dem letzten Besuch etwas dazugekommen ist. Der Punkt
 * verschwindet, sobald /neu offen war (Ereignis „tls-whatsnew-seen“).
 */
export function WhatsNewLink({ data = whatsNew, className = "" }) {
  const items = useMemo(() => whatsNewItems(data), [data]);
  const [dot, setDot] = useState(false);

  useEffect(() => {
    setDot(shouldShowDot(items));
    const clear = () => setDot(false);
    window.addEventListener("tls-whatsnew-seen", clear);
    return () => window.removeEventListener("tls-whatsnew-seen", clear);
  }, [items]);

  if (!items.length) return null;
  return (
    <Link to="/neu" data-testid="footer-whatsnew" className={`relative inline-flex items-center gap-1.5 ${className}`}>
      Neu
      {dot && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-[#29B6E8]" aria-hidden="true" data-testid="footer-whatsnew-dot" />
          <span className="sr-only">(neue Einträge)</span>
        </>
      )}
    </Link>
  );
}
