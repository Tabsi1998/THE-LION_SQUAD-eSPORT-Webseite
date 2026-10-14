import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { api, formatRequestError } from "@/lib/api";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { gameLabel } from "@/lib/gameLabels";
import { viennaDateTime } from "@/lib/vienna";
import { windowText } from "@/pages/admin/tournament/OnsiteAccessPanel";

// Aushang zum Vor-Ort-Zugang (#1592): ein A4-Blatt für Tisch oder Wand in der Halle - hell, damit der Drucker es gut
// schafft, und aus zwei bis drei Metern lesbar: Turnier, Termin, Spiel, ein großer QR-Code und was danach passiert.
// Der Code steht nur im QR-Code. Eigene Seite ohne Admin-Rahmen, damit der Druck nur das Blatt zeigt.

const START = { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" };

export default function AdminOnsitePosterPage() {
  const { id } = useParams();
  const [tournament, setTournament] = useState(null);
  const [access, setAccess] = useState(null);
  const [error, setError] = useState("");
  useDocumentTitle(tournament ? `Aushang – ${tournament.title}` : "Aushang", "Aushang mit QR-Code für die Anmeldung vor Ort.", { robots: "noindex, nofollow" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get(`/tournaments/${id}`), api.get(`/tournaments/${id}/onsite-access`)])
      .then(([t, a]) => {
        if (cancelled) return;
        setTournament(t.data);
        setAccess(a.data);
      })
      .catch((reason) => { if (!cancelled) setError(formatRequestError(reason, "Der Aushang konnte nicht geladen werden.")); });
    return () => { cancelled = true; };
  }, [id]);

  const url = access?.path ? `${window.location.origin}${access.path}` : "";
  const meta = tournament
    ? [tournament.start_date ? viennaDateTime(tournament.start_date, START) : null, tournament.game ? gameLabel(tournament.game) : null, tournament.location || null].filter(Boolean)
    : [];

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white print:bg-white print:min-h-0">
      <style>{"@page { size: A4 portrait; margin: 0; } @media print { html, body { background: #fff !important; } .tls-poster { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }"}</style>
      <div className="max-w-[820px] mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={`/admin/tournaments/${id}`} className="tls-btn tls-btn--quiet inline-flex min-h-[40px] items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
          <ArrowLeft className="w-3.5 h-3.5" /> Zum Turnier
        </Link>
        {access?.enabled ? (
          <button type="button" onClick={() => window.print()} data-testid="onsite-poster-print" className="tls-btn tls-btn--primary inline-flex min-h-[40px] items-center gap-2 px-5 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
            <Printer className="w-4 h-4" /> Drucken
          </button>
        ) : null}
      </div>

      {error ? <p className="max-w-[820px] mx-auto px-4 text-[#FF3B30]" role="alert">{error}</p> : null}
      {access && !access.enabled ? (
        <div className="max-w-[820px] mx-auto px-4" data-testid="onsite-poster-off">
          <div className="border border-[#FFD700]/40 bg-[#FFD700]/5 rounded-sm p-4 text-sm text-white/80">
            Der Vor-Ort-Zugang ist für dieses Turnier abgeschaltet – ein Aushang würde niemanden hineinlassen. Einschalten
            kannst du ihn beim Turnier unter „Vor-Ort-Anmeldung über QR“.
          </div>
        </div>
      ) : null}

      {tournament && access?.enabled ? (
        <div className="px-4 pb-10 print:p-0">
          <article
            className="tls-poster mx-auto flex w-full max-w-[794px] aspect-[210/297] flex-col bg-white text-[#0A0A0A] shadow-[0_24px_60px_rgba(0,0,0,0.45)] px-[7%] pt-[7%] pb-[6%] print:shadow-none print:w-[210mm] print:h-[297mm] print:max-w-none print:aspect-auto"
            data-testid="onsite-poster-sheet"
          >
            <header className="flex items-baseline justify-between gap-4 border-b-2 border-[#0A0A0A] pb-3 text-[clamp(10px,1.6vw,14px)] font-bold uppercase tracking-[0.2em]">
              <span>THE LION SQUAD</span>
              <span className="text-[#0A0A0A]/60">Anmeldung vor Ort</span>
            </header>

            <h1 className="mt-[6%] font-heading font-black uppercase leading-[0.92] text-[clamp(30px,7.2vw,64px)] [text-wrap:balance] break-words">
              {tournament.title}
            </h1>
            {meta.length ? (
              <p className="mt-3 text-[clamp(14px,2.6vw,24px)] font-semibold text-[#0A0A0A]/80">{meta.join(" · ")}</p>
            ) : null}

            <div className="mt-auto flex flex-col items-center">
              <div className="rounded-[6px] border-2 border-[#0A0A0A] p-[2.5%] w-[62%]">
                <BrandedQRCode value={url} size={440} accent="#0A0A0A" className="!w-full !h-auto [&_svg]:w-full [&_svg]:h-auto" />
              </div>
              <p className="mt-[4%] font-heading font-black uppercase text-[clamp(22px,5vw,44px)] leading-none">Scannen &amp; mitspielen</p>
              <p className="mt-3 max-w-[30ch] text-center text-[clamp(13px,2.1vw,19px)] leading-snug text-[#0A0A0A]/75">
                Auch ohne Vereinsmitgliedschaft. Konto anlegen oder anmelden, dann „Mitspielen“ – Plätze und Warteliste wie immer.
              </p>
            </div>

            <footer className="mt-auto flex flex-wrap items-baseline justify-between gap-2 border-t border-[#0A0A0A]/25 pt-3 text-[clamp(10px,1.5vw,13px)] text-[#0A0A0A]/65">
              <span>Gilt {windowText(access.window)}</span>
              <span>Fragen? Die Turnierleitung hilft gern.</span>
            </footer>
          </article>
        </div>
      ) : null}
    </div>
  );
}
