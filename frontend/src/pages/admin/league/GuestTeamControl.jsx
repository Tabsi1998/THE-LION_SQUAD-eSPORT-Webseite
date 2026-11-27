// Gastteam im Eingang (#1665, Entscheidung Nr. 286): Die Liga-Leitung setzt und bestätigt das Kennzeichen „Gast“ am Hauptteam - nie aus
// der Mitgliedschaft abgeleitet. Hier steht, was die Teamleitung angegeben hat (auch ein Schulname ohne Freigabe, den nur die Leitung
// sieht), und ob die Plakette ihn zeigt. Über das eigene Team entscheidet eine zweite Person; der Superadmin nur mit Grund (Nr. 73).
// Ein Team ohne Kennzeichen und ohne Angabe bekommt nur den leisen Knopf - der Eingang bleibt so ruhig wie vorher.
import { useState } from "react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { TextField } from "@/components/tls/FormFields";
import { GuestBadge } from "@/components/tls/league/GuestBadge";

const BUTTON = "inline-flex min-h-[40px] items-center rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const REASON_MIN = 5;
const OWN_TEAM = "Über dein eigenes Team entscheidet eine andere Person.";

/** Der Satz zur Angabe der Teamleitung - ohne Angabe sagt er, dass „Gast“ allein auch geht. */
export function guestInfoLine(info) {
  if (!info?.kind) return "kein Verein und keine Schule angegeben – die Plakette zeigt nur „Gast“.";
  const what = `${info.kind_label}${info.name ? ` ${info.name}` : ""}`;
  if (info.kind === "school" && info.name && !info.school_name_public) return `${what} – Name nicht freigegeben, öffentlich steht nur „Gast“.`;
  return what;
}

/** ``conflictReason``: der Grund der Notausnahme aus dem Feld der Anmeldung (eins je Anmeldung). ``onConflictReason``: Hat die Anmeldung
 * keine Knöpfe mehr (schon zugeteilt), steht das Feld hier - sonst bleibt es beim Feld der Entscheidung darunter. */
export function GuestTeamControl({ row, seasonId, superadmin, onChanged, conflictReason = "", onConflictReason = null }) {
  const info = row.guest_team || null;
  const [busy, setBusy] = useState(false);
  const confirmed = Boolean(info?.confirmed);
  const own = Boolean(row.own_team);
  const override = own ? conflictReason.trim() : "";
  const blocked = busy || (own && override.length < REASON_MIN);

  const send = async (next) => {
    setBusy(true);
    try {
      await api.put(`/admin/leagues/teams/${row.team_id}/guest-team`, {
        confirmed: next, season_id: seasonId, ...(override ? { conflict_reason: override } : {}),
      });
      toast.success(next ? "Als Gastteam bestätigt." : "Kennzeichen „Gast“ zurückgenommen.");
      onChanged?.();
    } catch (error) {
      toast.error(formatRequestError(error, "Das Kennzeichen ließ sich nicht speichern."));
    } finally {
      setBusy(false);
    }
  };

  const overrideField = own && superadmin && onConflictReason ? (
    <TextField label="Grund für die Notausnahme" value={conflictReason} onChange={onConflictReason} maxLength={500} className="mt-2 max-w-md"
      testId={`application-conflict-reason-${row.id}`} hint="Als Superadmin geht es trotzdem, mit mindestens fünf Zeichen. Der Grund steht im Protokoll." />
  ) : null;
  const may = !own || superadmin;

  if (!info) {
    if (!may) return null;
    return (
      <div className="mt-2" data-testid={`application-guest-${row.id}`}>
        {overrideField}
        <button type="button" disabled={blocked} onClick={() => send(true)} className={`tls-btn tls-btn--quiet ${BUTTON} mt-1`}
          data-testid={`application-guest-confirm-${row.id}`}>Als Gastteam kennzeichnen</button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-sm border border-white/10 bg-white/[0.03] p-2" data-testid={`application-guest-${row.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-white/70">Gastteam</span>
        {confirmed ? <GuestBadge badge={info.badge} testId={`application-guest-badge-${row.id}`} /> : <span className="text-xs text-white/60">noch nicht gekennzeichnet</span>}
      </div>
      <p className="mt-1 text-sm text-white/80 [overflow-wrap:anywhere]" data-testid={`application-guest-info-${row.id}`}>Angabe der Teamleitung: {guestInfoLine(info)}</p>
      {info.pending ? (
        <p className="mt-1 text-xs font-semibold text-warn" data-testid={`application-guest-pending-${row.id}`}>
          {confirmed ? "Seit der Bestätigung geändert – bis zur neuen Bestätigung steht öffentlich nur „Gast“." : "Wartet auf die Bestätigung der Liga-Leitung."}
        </p>
      ) : null}
      {own && !superadmin ? <p className="mt-1 text-sm font-semibold text-white/80" data-testid={`application-guest-own-${row.id}`}>{OWN_TEAM}</p> : null}
      {overrideField}
      {may ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {!confirmed || info.pending ? (
            <button type="button" disabled={blocked} onClick={() => send(true)} className={`tls-btn tls-btn--secondary ${BUTTON}`}
              data-testid={`application-guest-confirm-${row.id}`}>{confirmed ? "Neu bestätigen" : "Als Gastteam bestätigen"}</button>
          ) : null}
          {confirmed ? (
            <button type="button" disabled={blocked} onClick={() => send(false)} className={`tls-btn tls-btn--quiet ${BUTTON}`}
              data-testid={`application-guest-revoke-${row.id}`}>Kennzeichen zurücknehmen</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
