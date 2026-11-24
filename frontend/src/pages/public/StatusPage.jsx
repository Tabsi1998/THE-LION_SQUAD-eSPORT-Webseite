import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { LionArt } from "@/components/tls/LionArt";
import { LION_ART_SIZE } from "@/components/tls/PublicEmptyState";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { viennaDateTime } from "@/lib/vienna";

// Statusseite (#1657, Entscheidung 15.10.2026): zwei Zustände, die die Überwachung selbst umstellt - „Alles läuft“ und
// „Störung, wir sind dran“. Keine Einzelheiten (welcher Teil, warum), nur Deutsch. Antwortet der Server gar nicht, ist das
// selbst eine Störung. Die Seite fragt jede Minute neu; sie steht nicht im Suchindex und nicht in der Sitemap.

const POLL_MS = 60_000;
const STATES = {
  ok: {
    title: "Alles läuft",
    text: "Website, App und Anmeldung sind erreichbar.",
    art: "plain",
    tone: "border-ok/30",
    badge: "border-ok/40 bg-ok/10 text-ok",
  },
  disturbance: {
    title: "Störung, wir sind dran",
    text: "Gerade läuft nicht alles rund. Wir kümmern uns darum – schau später noch einmal vorbei.",
    art: "offline",
    tone: "border-warn/30",
    badge: "border-warn/40 bg-warn/10 text-warn",
  },
};

export default function StatusPage() {
  useDocumentTitle("Status", "Ob die Website von THE LION SQUAD gerade läuft.", { robots: "noindex, follow" });
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/ops/status");
        if (alive) setStatus({ state: data?.state === "ok" ? "ok" : "disturbance", checkedAt: data?.checked_at || null });
      } catch {
        if (alive) setStatus({ state: "disturbance", checkedAt: null });
      }
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const view = status ? STATES[status.state] : null;
  return (
    <PublicLayout>
      <section className="px-4 py-16">
        <div
          className={`max-w-xl w-full mx-auto border bg-[#121212] rounded-sm p-6 text-center ${view ? view.tone : "border-white/10"}`}
          data-testid="status-page"
          data-state={status?.state || "loading"}
          aria-live="polite"
        >
          {view ? (
            <>
              <div className="mx-auto mb-5 flex justify-center">
                <LionArt art={view.art} className={`shrink-0 text-white/90 ${LION_ART_SIZE}`} />
              </div>
              <span className={`inline-block text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-sm border ${view.badge}`}>Status</span>
              <h1 className="mt-3 font-heading text-2xl md:text-3xl font-black uppercase">{view.title}</h1>
              <p className="mt-3 text-sm text-white/60">{view.text}</p>
              {status.checkedAt ? (
                <p className="mt-4 text-xs text-white/40">Zuletzt geprüft: {viennaDateTime(status.checkedAt)}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-white/60">Wird geprüft …</p>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
