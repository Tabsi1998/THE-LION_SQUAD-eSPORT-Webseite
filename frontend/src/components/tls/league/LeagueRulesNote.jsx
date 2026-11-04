// Das Regelwerk auf Team-Seite und Matchseite (docs/LIGA.md, #2269): die gültige Fassung mit Weg zu Text und PDF und - nur für das eigene
// Co-Team - der Stand der Zustimmung. Verlangt eine neue Fassung Zustimmung, steht „Neue Fassung, bitte zustimmen“ mit Weg dorthin.
import { Link } from "react-router-dom";
import { AlertTriangle, Check, FileText, ScrollText } from "lucide-react";
import { API } from "@/lib/api";
import { dayLabel } from "@/lib/leagueRules";
import { viennaDate } from "@/lib/vienna";

const LONG_DAY = { day: "2-digit", month: "2-digit", year: "numeric" };

/** „open“: zustimmen; „agreed“: schon zugestimmt; null: nichts gefordert oder nicht das eigene Co-Team. */
export function rulesConsentState(rules) {
  const consent = rules?.consent;
  if (!consent?.required) return null;
  return consent.agreed ? "agreed" : "open";
}

export function LeagueRulesNote({ rules, testId = "league-rules-note", className = "" }) {
  if (!rules?.url) return null;
  const state = rulesConsentState(rules);
  const pdfHref = rules.pdf_url ? `${API}${String(rules.pdf_url).replace(/^\/api/, "")}` : null;
  return (
    <div className={`rounded-sm border px-4 py-3 text-sm ${state === "open" ? "border-warn/40 bg-warn/5" : "border-white/10 bg-[#121212]"} ${className}`}
      data-testid={testId} data-consent={state || "none"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to={rules.url} className="inline-flex items-center gap-1.5 font-bold text-white hover:text-[#29B6E8]" data-testid={`${testId}-link`}>
          <ScrollText className="h-4 w-4 text-[#29B6E8]" aria-hidden="true" /> Regelwerk
        </Link>
        <span className="text-white/65" data-testid={`${testId}-version`}>{rules.label}{rules.valid_from ? ` · gültig ab ${dayLabel(rules.valid_from)}` : ""}</span>
        {pdfHref ? (
          <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="tls-hit inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-[#29B6E8]" data-testid={`${testId}-pdf`}>
            <FileText className="h-3.5 w-3.5" aria-hidden="true" /> PDF
          </a>
        ) : null}
      </div>
      {state === "open" ? (
        <p role="status" className="mt-2 flex items-start gap-2 text-white/85" data-testid={`${testId}-consent`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <span>
            <strong className="text-warn">Neue Fassung, bitte zustimmen:</strong> {rules.consent?.demanded_label || rules.label} verlangt die Zustimmung deines Co-Teams.{" "}
            <Link to={rules.url} className="underline underline-offset-2 hover:text-white">Lesen und zustimmen</Link>
          </span>
        </p>
      ) : null}
      {state === "agreed" ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-white/60" data-testid={`${testId}-consent`}>
          <Check className="h-3.5 w-3.5 text-ok" aria-hidden="true" /> Dein Co-Team hat zugestimmt{rules.consent?.agreed_at ? ` (${viennaDate(rules.consent.agreed_at, LONG_DAY)})` : ""}.
        </p>
      ) : null}
    </div>
  );
}
