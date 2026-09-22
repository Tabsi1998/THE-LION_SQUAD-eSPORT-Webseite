import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/dolibarr";
import { verdictText } from "@/lib/memberCard";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

// Prüfseite der Mitgliedskarte (#346): Wer den QR-Code scannt, landet hier - ohne Anmeldung -
// und sieht nur, ob die Karte gilt, plus Vorname, Mitgliedsart und gültig bis. Warum eine
// Karte nicht gilt (abgelaufen, beendet, erfunden), sagt die Seite absichtlich nicht.

export default function MemberCardVerifyPage() {
  const { token } = useParams();
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(false);
  useDocumentTitle("Mitgliedskarte prüfen", "Prüfung einer digitalen Mitgliedskarte.", { robots: "noindex, nofollow" });

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    api.get(`/card/verify/${encodeURIComponent(token || "")}`)
      .then(({ data }) => { if (!cancelled) setResult(data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [token]);

  const verdict = verdictText(result);
  return (
    <PublicLayout>
      <section className="max-w-md mx-auto px-4 sm:px-6 py-16">
        <div className="text-center">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">{result?.club_name || "Mitgliedskarte"}</span>
          <h1 className="font-heading text-3xl font-black uppercase mt-2 inline-flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-[#FFD700]" /> Kartenprüfung</h1>
        </div>

        {failed ? (
          <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-6 text-center text-sm text-white/70" data-testid="card-verify-failed">
            Die Prüfung ist gerade nicht möglich. Bitte noch einmal scannen.
          </div>
        ) : (
          <div
            className={`mt-8 border rounded-sm p-6 text-center ${verdict.tone === "ok" ? "border-[#00FF88]/50 bg-[#00FF88]/5" : verdict.tone === "warn" ? "border-[#FF3B30]/50 bg-[#FF3B30]/5" : "border-white/10 bg-[#121212]"}`}
            data-testid="card-verify-result"
            data-valid={result ? String(Boolean(result.valid)) : "pending"}
          >
            {verdict.tone === "ok" ? <CheckCircle2 className="w-12 h-12 mx-auto text-[#00FF88]" /> : verdict.tone === "warn" ? <XCircle className="w-12 h-12 mx-auto text-[#FF3B30]" /> : null}
            <div className="mt-3 font-heading text-2xl font-black uppercase">{verdict.title}</div>
            {result?.valid ? (
              <dl className="mt-4 space-y-2 text-sm">
                <div><dt className="text-[10px] uppercase tracking-widest text-white/40">Mitglied</dt><dd className="text-lg font-bold text-white">{result.name}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-widest text-white/40">Mitgliedsart</dt><dd className="text-white/85">{result.type_label}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-widest text-white/40">Gültig</dt><dd className="text-white/85">{result.valid_until ? `bis ${formatDate(result.valid_until)}` : "solange die Mitgliedschaft besteht"}</dd></div>
                {result.checked_at && <div className="pt-2 text-xs text-white/40">Geprüft am {new Date(result.checked_at).toLocaleString("de-DE")}</div>}
              </dl>
            ) : result ? (
              <p className="mt-3 text-sm text-white/70">Dieser Code ist nicht (mehr) gültig. Das Mitglied kann in der App oder auf der Website einen frischen Code anzeigen.</p>
            ) : (
              <p className="mt-3 text-sm text-white/50">Einen Moment …</p>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-white/40">
          Bitte den Namen mit einem Ausweis abgleichen. Mehr als Vorname und Mitgliedsart zeigt diese Seite nicht. <Link to="/membership/join" className="text-[#FFD700] hover:underline">Selbst Mitglied werden</Link>
        </p>
      </section>
    </PublicLayout>
  );
}
