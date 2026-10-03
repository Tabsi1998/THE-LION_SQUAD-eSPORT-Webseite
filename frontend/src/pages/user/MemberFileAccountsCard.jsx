import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { SwitchRow } from "@/pages/user/profile/SwitchRow";
import { toast } from "sonner";
import { Link2 } from "lucide-react";

// Konten in der Mitgliederakte (#846): ein auf der Website geprüftes Konto (Profil → Socials, „Mit … verknüpfen“) geht nur
// auf Wunsch in die Akte - je Konto ein Schalter. Wünscht der Verein ein Konto, das fehlt, steht hier der Weg zum Verknüpfen.

export function accountLine(row) {
  const inFile = row?.in_file || {};
  if (row?.shared && inFile.confirmed) return `In der Akte: ${inFile.handle} – bestätigt durch die Website`;
  if (inFile.handle) return `In der Akte: ${inFile.handle}${inFile.confirmed ? " – bestätigt" : " – vom Vorstand eingetragen"}`;
  if (row?.website?.linked) return `Auf der Website verknüpft: ${row.website.handle} – noch nicht in der Akte`;
  return "Auf der Website nicht verknüpft";
}

export function MemberFileAccountsCard() {
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    api.get("/membership/me/accounts").then(({ data }) => setView(data)).catch(() => setView(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "profile"]);

  if (!view) return null;
  // Ohne Verbindung zur Akte erklärt die Karte „Vereinsakte“ den Weg; hier steht nur, was die Fähigkeit oder das Recht betrifft.
  if (!view.available && !["no_capability", "right_missing"].includes(view.reason)) return null;

  const toggle = async (row, on) => {
    setBusy(row.network);
    try {
      const { data } = await api.put(`/membership/me/accounts/${row.network}`, { share: on });
      setView(data);
      toast.success(on ? `${row.label} steht jetzt in deiner Mitgliederakte.` : `${row.label} ist aus deiner Mitgliederakte heraus.`);
    } catch (error) {
      toast.error(formatApiError(error?.response?.data?.detail) || "Nicht gespeichert.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="membership-accounts-card">
      <h2 className="font-heading text-lg font-black uppercase inline-flex items-center gap-2"><Link2 className="w-4 h-4 text-[#FFD700]" /> Meine Konten in der Mitgliederakte</h2>
      {!view.available ? (
        <p className="mt-2 text-sm text-white/70" data-testid="membership-accounts-reason">{view.text}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-white/70">
            Ein Konto, das du auf der Website verknüpft hast, kommt auf deinen Wunsch in deine Mitgliederakte – dort steht es als
            „bestätigt durch die Website“. Ausschalten oder Trennen nimmt es wieder heraus. Übertragen werden nur Name und Kennung, nie Kennwörter.
          </p>
          {(view.wishes || []).map((wish) => (
            <div key={wish.network} className="mt-3 border border-[#FFD700]/40 bg-[#FFD700]/5 rounded-sm px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2" data-testid={`membership-accounts-wish-${wish.network}`}>
              <span>Der Verein wünscht: <b>{wish.label}</b> verknüpfen.</span>
              <Link to={`/profile?tab=socials&link=${encodeURIComponent(wish.platform)}`} className="text-[#FFD700] font-bold uppercase tracking-wider text-xs hover:underline" data-testid={`membership-accounts-link-${wish.network}`}>
                Jetzt verknüpfen
              </Link>
            </div>
          ))}
          <div className="mt-4 space-y-2">
            {(view.accounts || []).map((row) => (
              <SwitchRow
                key={row.network}
                label={row.label}
                description={accountLine(row)}
                hint={row.asked_label ? `${row.asked_label} dieses Konto.` : ""}
                checked={!!row.shared}
                disabled={!row.can_share || busy === row.network}
                onCheckedChange={(on) => toggle(row, on)}
                testId={`membership-accounts-${row.network}`}
              />
            ))}
            {!(view.accounts || []).length && (
              <p className="text-sm text-white/50" data-testid="membership-accounts-empty">Noch kein Konto verknüpft – das geht im Profil unter „Socials“.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
