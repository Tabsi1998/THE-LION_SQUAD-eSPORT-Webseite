import { Link } from "react-router-dom";
import { BookOpen, ListChecks, Gamepad2, GitBranch } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { GUIDE_FORMATS, GUIDE_GAME_TYPES, GUIDE_STEPS, formatLabel } from "@/lib/tournamentGuide";

// Turnier-Leitfaden (#228, Block 16): welches Turnier man wie einstellt. Teil 1 Ablauf, Teil 2
// nach Turnierform, Teil 3 welches Format wofür. Der Knopf „Voreinstellung übernehmen“ folgt
// als Schritt 2 (#368) am vorhandenen RulePresetPicker.

export default function AdminTournamentGuidePage() {
  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-black uppercase inline-flex items-center gap-3"><BookOpen className="w-7 h-7 text-[#29B6E8]" /> Turnier-Leitfaden</h1>
          <p className="mt-2 text-sm text-white/60 max-w-2xl">Welches Turnier man wie einstellt – aus den Regelwerken der großen Anbieter, übersetzt auf die Felder hier. Erst der Ablauf, der für jedes Spiel gilt, dann die Turnierform, dann das Format.</p>
        </div>
        <Link to="/admin/tournaments/new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs" data-testid="guide-new-tournament">Turnier anlegen</Link>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-wider" aria-label="Leitfaden">
        <a href="#ablauf" className="px-3 py-1.5 border border-white/15 rounded-sm text-white/70 hover:text-white">1 · Ablauf</a>
        <a href="#turnierformen" className="px-3 py-1.5 border border-white/15 rounded-sm text-white/70 hover:text-white">2 · Turnierformen</a>
        <a href="#formate" className="px-3 py-1.5 border border-white/15 rounded-sm text-white/70 hover:text-white">3 · Welches Format wofür</a>
      </nav>

      <section id="ablauf" className="mt-8 scroll-mt-24" data-testid="guide-steps">
        <h2 className="font-heading text-xl font-black uppercase inline-flex items-center gap-2"><ListChecks className="w-5 h-5 text-[#29B6E8]" /> 1 · Der Ablauf, unabhängig vom Spiel</h2>
        <ol className="mt-4 space-y-3">
          {GUIDE_STEPS.map((step, index) => (
            <li key={step.key} className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid={`guide-step-${step.key}`}>
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 shrink-0 rounded-sm bg-[#29B6E8]/15 text-[#29B6E8] font-heading font-black inline-flex items-center justify-center">{index + 1}</span>
                <div className="min-w-0">
                  <div className="font-bold text-white">{step.title}</div>
                  <p className="mt-1 text-sm text-white/65">{step.why}</p>
                  <p className="mt-1 text-sm text-white/85"><span className="text-white/45">So einstellen: </span>{step.how}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {step.fields.map((field) => <span key={field} className="px-2 py-0.5 border border-[#29B6E8]/30 text-[#29B6E8] rounded-sm text-[10px] uppercase tracking-wider font-bold">{field}</span>)}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="turnierformen" className="mt-10 scroll-mt-24" data-testid="guide-game-types">
        <h2 className="font-heading text-xl font-black uppercase inline-flex items-center gap-2"><Gamepad2 className="w-5 h-5 text-[#FFD700]" /> 2 · Nach Turnierform</h2>
        <p className="mt-2 text-sm text-white/55">Teamgröße, übliche Serie und was im Regelwerk stehen sollte. Die Liste wächst mit den Spielen, die der Verein wirklich spielt.</p>
        <div className="mt-4 border border-white/10 rounded-sm bg-[#121212] overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Turnierform</th>
                <th className="text-left px-4 py-3">Teamgröße</th>
                <th className="text-left px-4 py-3">Übliche Serie</th>
                <th className="text-left px-4 py-3">Format hier</th>
                <th className="text-left px-4 py-3">Besonderheit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {GUIDE_GAME_TYPES.map((kind) => (
                <tr key={kind.key} data-testid={`guide-game-${kind.key}`}>
                  <td className="px-4 py-3"><div className="font-bold text-white">{kind.label}</div><div className="text-xs text-white/45">{kind.examples}</div></td>
                  <td className="px-4 py-3 text-white/80 whitespace-nowrap">{kind.team}</td>
                  <td className="px-4 py-3 text-white/80">{kind.series}</td>
                  <td className="px-4 py-3 text-[#FFD700] whitespace-nowrap">{formatLabel(kind.format)}</td>
                  <td className="px-4 py-3 text-white/65">{kind.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="formate" className="mt-10 scroll-mt-24" data-testid="guide-formats">
        <h2 className="font-heading text-xl font-black uppercase inline-flex items-center gap-2"><GitBranch className="w-5 h-5 text-[#9F7AEA]" /> 3 · Welches Format wofür</h2>
        <div className="mt-4 grid md:grid-cols-2 gap-3">
          {GUIDE_FORMATS.map((format) => (
            <div key={format.key} className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid={`guide-format-${format.key}`}>
              <div className="font-bold text-white">{format.label}</div>
              <p className="mt-1 text-sm text-white/65">{format.when}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-white/45">Bilder zu den Formaten kommen über die Medienverwaltung; der Knopf „Diese Voreinstellung übernehmen“ im Formular „Turnier anlegen“ ist Schritt 2 (#368).</p>
      </section>
    </AdminLayout>
  );
}
