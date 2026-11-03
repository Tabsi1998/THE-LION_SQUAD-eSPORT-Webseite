// Das Regelwerk als Text (docs/LIGA.md, #1646): Abschnitte vom Server mit festen Ankern, Markierung geänderter Abschnitte, Vergleich Wort für
// Wort. Die Regelseite und die Vorschau der Verwaltung zeigen dasselbe.
import { Fragment, forwardRef, useMemo } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { changeRows, renderRulesSection } from "@/lib/leagueRules";
import "./rules.css";

const MARK_WORD = { new: "Neu", changed: "Geändert" };
const STATUS_WORD = { new: "Neu", changed: "Geändert", removed: "Entfernt" };

function copyLink(anchor) {
  const url = `${window.location.origin}${window.location.pathname}${window.location.search}#${anchor}`;
  navigator.clipboard?.writeText(url).then(() => toast.success("Link kopiert."), () => {});
}

function Section({ row, marks, versionLabel, annexStart }) {
  const html = useMemo(() => renderRulesSection(row.body_md), [row.body_md]);
  const mark = marks ? row.mark : null;
  const Heading = `h${Math.min(row.level + 1, 4)}`;
  return (
    <section id={row.anchor} className="tls-rules-section" data-level={row.level} data-annex-start={annexStart ? "true" : undefined}
      {...(mark ? { "data-mark": mark } : {})}>
      {mark ? <span className="tls-rules-badge">{MARK_WORD[mark]} in {versionLabel}</span> : null}
      {row.title ? (
        <Heading className="tls-rules-heading" data-level={row.level}>
          <span className="min-w-0">{row.title}</span>
          <a href={`#${row.anchor}`} className="tls-rules-anchor" aria-label={`Link auf ${row.title}`} onClick={() => copyLink(row.anchor)}>
            <Link2 className="h-4 w-4" aria-hidden="true" />
          </a>
        </Heading>
      ) : null}
      {html ? <div className="prose-cms" dangerouslySetInnerHTML={{ __html: html }} /> : null}
    </section>
  );
}

/** Der Text. ``ref`` zeigt auf den Bereich, in dem die Suche der Seite sucht. */
export const RulesDocument = forwardRef(function RulesDocument({ sections, marks = true, versionLabel, testId = "rules-document" }, ref) {
  const firstAnnex = sections.find((row) => row.kind === "annex")?.anchor;
  return (
    <article ref={ref} className="tls-rules-doc" data-testid={testId}>
      {sections.map((row) => (
        <Section key={row.anchor} row={row} marks={marks} versionLabel={versionLabel} annexStart={row.anchor === firstAnnex} />
      ))}
    </article>
  );
});

/** „Neu in Version X“: was sich zur vorigen Fassung geändert hat, mit Links zu den Stellen. */
export function RulesChanges({ changes, versionLabel, children, testId = "rules-changes" }) {
  const rows = changeRows(changes);
  if (!rows.length) return null;
  return (
    <section className="tls-rules-changes" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id={`${testId}-title`} className="font-heading text-lg font-black uppercase">Neu in {versionLabel}</h2>
        {children}
      </div>
      {changes.base ? <p className="mb-2 text-sm text-white/70">Im Vergleich zu {changes.base.label}.</p> : null}
      <ul>
        {rows.map((row) => (
          <li key={`${row.kind}-${row.anchor || row.title}`} className="tls-rules-changes__row">
            {row.anchor ? (
              <>
                <span className="tls-rules-changes__word">{row.word}:</span>
                <a href={`#${row.anchor}`}>{row.title}</a>
              </>
            ) : <span>{row.word}: {row.title}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Text mit Änderungen: ``ins`` unterstrichen, ``del`` durchgestrichen - beides auch ohne Farbe erkennbar. */
export function RuleOps({ ops = [] }) {
  return (
    <p className="tls-rules-ops">
      {ops.map((row, index) => (
        // Die Reihenfolge der Stücke steht fest - sie ändern sich nur mit dem ganzen Vergleich.
        <Fragment key={index}>
          {row.op === "ins" ? <><span className="sr-only">Neu: </span><ins>{row.text}</ins></> : null}
          {row.op === "del" ? <><span className="sr-only">Entfernt: </span><del>{row.text}</del></> : null}
          {row.op === "eq" ? row.text : null}
        </Fragment>
      ))}
    </p>
  );
}

/** Der Vergleich zweier Fassungen, Abschnitt für Abschnitt. Unverändertes steht nur als Zahl da. */
export function RulesComparison({ sections = [], children, testId = "rules-compare" }) {
  const changed = sections.filter((row) => row.status !== "same");
  const same = sections.length - changed.length;
  return (
    <div className="tls-rules-doc" data-testid={testId}>
      {children}
      <p className="tls-rules-compare__legend">
        Neu ist unterstrichen, Entferntes durchgestrichen.
        {same ? ` ${same} ${same === 1 ? "Abschnitt" : "Abschnitte"} unverändert.` : ""}
      </p>
      {changed.length ? changed.map((row) => {
        const Heading = `h${Math.min((row.level || 1) + 1, 4)}`;
        return (
          <section key={`${row.status}-${row.anchor}`} className="tls-rules-section" data-level={row.level || 1} data-mark={row.status}>
            {row.title ? (
              <Heading className="tls-rules-heading" data-level={row.level || 1}>
                <span className="min-w-0">
                  {row.title}
                  <span className="tls-rules-status">{STATUS_WORD[row.status]}</span>
                </span>
              </Heading>
            ) : <span className="tls-rules-badge">{STATUS_WORD[row.status]}</span>}
            {row.previous_title ? <p className="mb-2 text-sm text-white/70">Hieß vorher: {row.previous_title}</p> : null}
            {row.coarse ? <p className="mb-2 text-sm text-white/70" data-testid="rules-compare-coarse">Zu lang für Wort für Wort: Der Abschnitt steht ganz da, erst alt, dann neu.</p> : null}
            <RuleOps ops={row.ops} />
          </section>
        );
      }) : <p className="text-white/70">Die beiden Fassungen unterscheiden sich nicht.</p>}
    </div>
  );
}
