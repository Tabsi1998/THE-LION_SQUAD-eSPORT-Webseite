import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BookOpen, Copy, ExternalLink } from "lucide-react";
import { SETUP_GUIDES, resolveGuideValue } from "@/lib/setupGuides";

// Eine Einrichtungsanleitung (siehe lib/setupGuides): aufklappbar, nummerierte Schritte, Links zu
// den Entwickler-Konsolen und Werte zum Kopieren (Rückrufadressen, Adresse der Website).

const STATE_CLASS = {
  ok: "border-[#00FF88]/40 text-[#00FF88]",
  missing: "border-[#FFD700]/50 text-[#FFD700]",
  optional: "border-white/15 text-white/50",
  unknown: "border-white/10 text-white/35",
};
const STATE_LABEL = { ok: "Eingerichtet", missing: "Fehlt", optional: "Optional", unknown: "–" };

export function StatusChip({ status }) {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center gap-1 border rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider normal-case ${STATE_CLASS[status.state] || STATE_CLASS.unknown}`} data-testid="setup-status">
      {STATE_LABEL[status.state] || status.state}{status.text ? ` · ${status.text}` : ""}
    </span>
  );
}

export function SetupGuide({ guideKey, open = false, status = null, showWhere = false }) {
  const guide = SETUP_GUIDES[guideKey];
  if (!guide) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Kopiert.");
    } catch {
      toast.error("Konnte nicht kopieren – bitte den Wert markieren und kopieren.");
    }
  };
  return (
    <details open={open} className="border border-white/10 bg-[#0F0F0F] rounded-sm" data-testid={`setup-guide-${guide.key}`}>
      <summary className="cursor-pointer select-none px-4 py-3 flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80 hover:text-white">
        <BookOpen className="w-4 h-4 text-[#29B6E8] shrink-0" /> So richtest du es ein: {guide.title}
        <StatusChip status={status} />
      </summary>
      <div className="px-4 pb-4 space-y-3">
        <p className="text-xs text-white/55">{guide.summary}</p>
        <ol className="space-y-2 text-sm text-white/80 list-decimal pl-5">
          {guide.steps.map((step, index) => (
            <li key={index}>
              {step.text}
              {step.link && (
                <>
                  {" "}
                  <a href={step.link.href} target="_blank" rel="noreferrer" data-testid={`setup-link-${guide.key}-${index}`} className="inline-flex items-center gap-1 text-[#29B6E8] hover:text-white">
                    {step.link.label} <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}
              {step.copy && (
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="text-[11px] text-[#29B6E8] bg-black/40 border border-white/10 px-2 py-1 rounded-sm break-all" data-testid={`setup-value-${guide.key}-${index}`}>{resolveGuideValue(step.copy, origin)}</code>
                  <button type="button" onClick={() => copy(resolveGuideValue(step.copy, origin))} data-testid={`setup-copy-${guide.key}-${index}`} className="inline-flex items-center gap-1 px-2 py-1 border border-white/15 rounded-sm text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-white hover:border-white/40">
                    <Copy className="w-3 h-3" /> Kopieren
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {guide.notes?.length > 0 && (
          <ul className="text-xs text-white/50 list-disc pl-5 space-y-1">
            {guide.notes.map((note, index) => <li key={index}>{note}</li>)}
          </ul>
        )}
        {showWhere && guide.where && (
          <Link to={guide.where.to} data-testid={`setup-where-${guide.key}`} className="inline-block text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">{guide.where.label} →</Link>
        )}
      </div>
    </details>
  );
}

export default SetupGuide;
