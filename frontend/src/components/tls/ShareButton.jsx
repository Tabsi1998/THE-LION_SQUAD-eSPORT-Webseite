import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { toast } from "sonner";
import { sharePage } from "@/lib/sharePage";

// „Teilen“ oben rechts auf Event, Turnier, Fast Lap, Team und Album (#1154): am Handy das Teilen-Menü des Browsers,
// am PC „Link kopieren“ mit kurzer Bestätigung. Ein leiser Knopf (#1082) - die Seite bleibt das Wichtige.

export function ShareButton({ kind, id, title, detail, start, end, className = "", testId = "page-share" }) {
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const label = canNativeShare ? "Teilen" : "Link kopieren";
  const onClick = async () => {
    const result = await sharePage({ kind, id, title, detail, start, end });
    if (result.status === "copied") {
      setCopied(true);
      toast.success("Link kopiert.");
      window.setTimeout(() => setCopied(false), 2000);
    } else if (result.status === "failed") {
      toast.error("Teilen ging gerade nicht.");
    }
  };
  const Icon = copied ? Check : Share2;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-native={canNativeShare ? "1" : "0"}
      aria-label={`${title}: ${label}`}
      className={`tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider ${className}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{copied ? "Kopiert" : label}</span>
    </button>
  );
}
