import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { SetupGuide, StatusChip } from "@/components/tls/SetupGuide";
import { api } from "@/lib/api";
import { SETUP_GUIDE_ORDER, guideStatus } from "@/lib/setupGuides";
import { FAQ_TOPICS, filterFaq } from "@/lib/adminFaq";

// Einrichtung (Wunsch des Betreibers, 24.09.): alle Anleitungen an einer Stelle - je Dienst der Stand
// (eingerichtet, fehlt, optional). Seit #511 (25.09.) als FAQ: Fragen nach Thema, je Frage die Antwort in
// Alltagssprache, der Weg genau an die Stelle im Admin und - wo es eine gibt - die Schritt-für-Schritt-
// Anleitung eingehängt. Was fehlt, steht offen; eine Suche geht über alle Fragen.

export default function AdminSetupPage() {
  const [data, setData] = useState({});
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const requests = [
      ["branding", "/settings/branding"], ["discord", "/settings/discord"], ["auth", "/settings/auth"],
      ["email", "/settings/email"], ["smtp", "/settings/smtp"], ["dolibarr", "/admin/dolibarr/status"], ["links", "/me/platform-links"],
    ];
    const results = await Promise.allSettled(requests.map(([, url]) => api.get(url)));
    const next = {};
    results.forEach((result, index) => {
      const key = requests[index][0];
      if (result.status === "fulfilled") next[key] = key === "links" ? (result.value.data?.available || null) : (result.value.data || null);
      else next[key] = null;
    });
    setData(next);
  }, []);
  useEffect(() => { load(); }, [load]);

  const statuses = useMemo(() => Object.fromEntries(SETUP_GUIDE_ORDER.map((key) => [key, guideStatus(key, data)])), [data]);
  const done = SETUP_GUIDE_ORDER.filter((key) => statuses[key].state === "ok").length;
  const missing = SETUP_GUIDE_ORDER.filter((key) => statuses[key].state === "missing").length;
  const topics = useMemo(() => filterFaq(query), [query]);
  const total = FAQ_TOPICS.reduce((sum, topic) => sum + topic.questions.length, 0);
  const shown = topics.reduce((sum, topic) => sum + topic.questions.length, 0);
  // Anleitungen, die keine Frage einhängt, stehen unten - damit nichts verloren geht.
  const linked = new Set(FAQ_TOPICS.flatMap((topic) => topic.questions.map((question) => question.guide).filter(Boolean)));
  const orphanGuides = SETUP_GUIDE_ORDER.filter((key) => !linked.has(key));

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">System</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Einrichtung</h1>
      <p className="text-sm text-white/55 mt-2 max-w-3xl">
        Fragen und Antworten für den Admin: je Frage die Antwort, der Weg genau an die Stelle und – wo es eine gibt – die Anleitung Schritt für Schritt.
        Der Stand der Dienste kommt aus den Einstellungen; was fehlt, steht offen.
      </p>
      <div className="mt-4 mb-6 flex flex-wrap gap-3 text-xs" data-testid="setup-summary">
        <span className="border border-[#00FF88]/40 text-[#00FF88] rounded-sm px-3 py-1.5 font-bold uppercase tracking-wider">{done} eingerichtet</span>
        <span className="border border-[#FFD700]/50 text-[#FFD700] rounded-sm px-3 py-1.5 font-bold uppercase tracking-wider">{missing} fehlen</span>
        <span className="border border-white/15 text-white/50 rounded-sm px-3 py-1.5 font-bold uppercase tracking-wider">{SETUP_GUIDE_ORDER.length - done - missing} optional oder offen</span>
      </div>

      <div className="max-w-4xl">
        <label className="relative block mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Frage suchen – z. B. Webhook, Rechnung, Sponsor, Turnier …" data-testid="setup-faq-search"
            className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm pl-9 pr-3 py-2.5 text-sm focus:border-[#29B6E8] outline-none" />
        </label>
        <div className="text-[11px] text-white/40 mb-4" data-testid="setup-faq-count">{shown} von {total} Fragen{query ? ` zu „${query}“` : ""}</div>
        {!topics.length && <div className="border border-dashed border-white/15 rounded-sm p-6 text-sm text-white/50" data-testid="setup-faq-empty">Keine Frage passt – anders formulieren oder unten im Menü suchen.</div>}
        <div className="space-y-6">
          {topics.map((topic) => (
            <section key={topic.key} data-testid={`setup-topic-${topic.key}`}>
              <h2 className="font-heading text-lg font-black uppercase mb-2">{topic.label}</h2>
              <div className="space-y-2">
                {topic.questions.map((question) => {
                  const status = question.guide ? statuses[question.guide] : null;
                  const open = Boolean(query) || status?.state === "missing";
                  return (
                    <details key={question.key} open={open} className="border border-white/10 bg-[#0F0F0F] rounded-sm" data-testid={`setup-faq-${question.key}`}>
                      <summary className="cursor-pointer select-none px-4 py-3 flex flex-wrap items-center gap-2 text-sm font-bold text-white/85 hover:text-white">
                        {question.q}
                        {status && <StatusChip status={status} />}
                      </summary>
                      <div className="px-4 pb-4 space-y-3">
                        <p className="text-sm text-white/70">{question.a}</p>
                        <Link to={question.to} data-testid={`setup-faq-link-${question.key}`} className="inline-block text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">{question.label} →</Link>
                        {question.guide && <SetupGuide guideKey={question.guide} status={status} open={status?.state === "missing"} />}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {!query && orphanGuides.length > 0 && (
          <section className="mt-8" data-testid="setup-other-guides">
            <h2 className="font-heading text-lg font-black uppercase mb-2">Weitere Anleitungen</h2>
            <div className="space-y-2">
              {orphanGuides.map((key) => <SetupGuide key={key} guideKey={key} status={statuses[key]} open={statuses[key].state === "missing"} showWhere />)}
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}
