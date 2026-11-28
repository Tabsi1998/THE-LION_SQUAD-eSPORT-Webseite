import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { verdictText } from "@/lib/memberCard";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatOfficialDate, formatWhen } from "@/lib/datetime";
import { ShortCaps } from "@/components/tls/ShortCaps";

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
          <span className="tls-type-small font-bold text-honor">{result?.club_name || "Mitgliedskarte"}</span>
          <h1 className="tls-type-title mt-2 inline-flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-honor" /> <ShortCaps>Kartenprüfung</ShortCaps></h1>
        </div>

        {failed ? (
          <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-6 text-center tls-type-small text-white/70" data-testid="card-verify-failed">
            Die Prüfung ist gerade nicht möglich. Bitte noch einmal scannen.
          </div>
        ) : (
          <div
            className={`mt-8 border rounded-sm p-6 text-center ${verdict.tone === "ok" ? "border-ok/50 bg-ok/5" : verdict.tone === "warn" ? "border-warn/50 bg-warn/5" : "border-white/10 bg-[#121212]"}`}
            data-testid="card-verify-result"
            data-valid={result ? String(Boolean(result.valid)) : "pending"}
          >
            {verdict.tone === "ok" ? <CheckCircle2 className="w-12 h-12 mx-auto text-ok" /> : verdict.tone === "warn" ? <XCircle className="w-12 h-12 mx-auto text-warn" /> : null}
            <div className="mt-3 tls-type-section">{verdict.title}</div>
            {result?.valid ? (
              <dl className="mt-4 space-y-2 tls-type-small">
                <div><dt className="tls-type-label text-quiet">Mitglied</dt><dd className="tls-type-card text-white">{result.name}</dd></div>
                <div><dt className="tls-type-label text-quiet">Mitgliedsart</dt><dd className="text-white/85">{result.type_label}</dd></div>
                <div><dt className="tls-type-label text-quiet">Gültig</dt><dd className="text-white/85">{result.valid_until ? `bis ${formatOfficialDate(result.valid_until)}` : "solange die Mitgliedschaft besteht"}</dd></div>
                {result.checked_at && <div className="pt-2 tls-type-small text-quiet">Geprüft am {formatWhen(result.checked_at, { relative: false })}</div>}
              </dl>
            ) : result ? (
              <p className="mt-3 tls-type-body text-white/70">Dieser Code ist nicht (mehr) gültig. Das Mitglied kann in der App oder auf der Website einen frischen Code anzeigen.</p>
            ) : (
              <p className="mt-3 tls-type-small text-white/50">Einen Moment …</p>
            )}
          </div>
        )}

        <p className="mt-6 text-center tls-type-small text-quiet">
          Bitte den Namen mit einem Ausweis abgleichen. Mehr als Vorname und Mitgliedsart zeigt diese Seite nicht. <Link to="/membership/join" className="text-honor hover:underline">Selbst Mitglied werden</Link>
        </p>
      </section>
    </PublicLayout>
  );
}
