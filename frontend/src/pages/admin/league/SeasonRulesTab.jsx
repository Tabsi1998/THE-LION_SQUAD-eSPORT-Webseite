// Reiter „Regelwerk und Sperrliste“ der Season-Seite (#2267): Stand des Regelwerks mit Versionen (B.2) und Weg dorthin, darunter die
// Sperrliste der Ausrüstung (C.4). Das alte Freitextfeld „Regeltext“ gibt es hier nicht mehr: Mit Regelwerk ist es ausgeblendet, ohne
// steht nur ein Hinweis mit Weg zum Regelwerk. Ein vorhandener Regeltext bleibt gespeichert und lesbar (Ligaseite ohne Regelwerk).
import { Link } from "react-router-dom";
import { ArrowRight, FileText } from "lucide-react";
import { FormSection } from "@/components/tls/AdminForm";
import { dayNoon, viennaDate } from "@/lib/vienna";
import { SeasonLoadoutBansPanel } from "./SeasonLoadoutBansPanel";

const LONG_DAY = { day: "2-digit", month: "2-digit", year: "numeric" };

function versionLine(version) {
  if (!version) return "";
  const from = String(version.valid_from || "");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(from) ? dayNoon(from) : from;
  return `${version.label}${from ? `, gilt ab ${viennaDate(day, LONG_DAY)}` : ""}`;
}

export function SeasonRulesTab({ seasonId, season, canSeason, canRules, rulesView, rulesNotice, rulesLink, onPendingSync }) {
  const current = rulesView?.current;
  const hasRules = Boolean(current || rulesView?.inherited || (rulesView?.versions || []).length) || (!rulesView && rulesNotice?.kind !== "missing");
  const legacy = String(season.rules_text || "").trim();
  return (
    <div className="space-y-6">
      <FormSection title="Regelwerk" testId="season-rules" hint="Versionen, PDF und Zustimmung der Teams pflegst du auf der Seite des Regelwerks.">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1 text-sm" data-testid="season-rules-state">
            {current ? (
              <p className="text-white/85"><FileText className="mr-1.5 inline h-4 w-4 align-[-3px] text-[#29B6E8]" aria-hidden="true" />Gültig: <strong className="text-white">{versionLine(current)}</strong></p>
            ) : null}
            {rulesView?.draft ? <p className="text-white/70">Ein Entwurf ist in Arbeit – er gilt erst, wenn du ihn freigibst.</p> : null}
            {/* Fehlt das Regelwerk, sagt das der Kasten darunter; hier nur, was sonst noch freigegeben werden muss. */}
            {rulesNotice?.kind === "changed" ? <p className="text-warn" data-testid="season-rules-tab-notice">{rulesNotice.text}</p> : null}
          </div>
          {canRules ? (
            <Link to={rulesLink} data-testid="season-rules-link"
              className="tls-btn tls-btn--secondary inline-flex min-h-[40px] items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
              Regelwerk mit Versionen pflegen <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {!hasRules ? (
          <p className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm text-white/70" data-testid="season-rules-missing">
            Regeln stehen im Regelwerk mit Versionen – ohne veröffentlichte Fassung geht keine Anmeldung und keine Veröffentlichung.
            {canRules ? " Über „Regelwerk mit Versionen pflegen“ legst du es an." : " Anlegen kann es, wer in dieser Liga „Regeln veröffentlichen“ darf."}
          </p>
        ) : null}
        {!hasRules && legacy ? (
          <details className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid="season-rules-legacy">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-white/60">Alter Regeltext (gilt bis zum ersten Regelwerk)</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-white/75">{legacy}</pre>
          </details>
        ) : null}
      </FormSection>
      {/* C.4 (#2218): Sperrliste der Ausrüstung - eigenständig, lädt sich selbst; Staffeln bekommen sie beim Übertragen. */}
      <div id="sperrliste" className="scroll-mt-24">
        <SeasonLoadoutBansPanel seasonId={seasonId} canEdit={canSeason} onSaved={onPendingSync} />
      </div>
    </div>
  );
}
