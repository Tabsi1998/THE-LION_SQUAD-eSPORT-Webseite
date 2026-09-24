import { Link } from "react-router-dom";
import { CalendarClock, Users, Wallet } from "lucide-react";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { formatDateTime } from "@/lib/datetime";
import { formatCents } from "@/lib/pricing";

// Turnierseite (#401): „Dein Stand“ für Angemeldete - Status, Team, Startgeld und Zahlungsstand,
// Check-in-Fenster, Weg zum Spielplan; Abmelden als leiser Link am Ende, nicht als roter Knopf vorne.

export function paymentLine(price) {
  if (!price) return null;
  const amount = formatCents(price.total_cents, price.currency);
  if (price.billing_status === "cancelled") return `${amount} · storniert`;
  if (price.billing_status === "paid") return `${amount} · Rechnung ${price.invoice_ref || ""} bezahlt – danke!`.replace("  ", " ");
  if (price.invoice_ref && price.invoice_status !== "draft") return `${amount} · Rechnung ${price.invoice_ref} offen – unter „Meine Rechnungen“`;
  return `${amount} · die Rechnung kommt unter „Meine Rechnungen“`;
}

export function MyStandCard({ tournament: t, registration: myReg, team = null, isTeamTournament = false, canCheckIn = false, staffOnlyCheckIn = false, canUnregister = false, onCheckin, onUnregister, busy = false, scheduleTo = "" }) {
  if (!myReg) return null;
  const checkinOpen = t.status === "check_in";
  const line = paymentLine(myReg.price);
  return (
    <section className="border border-[#FFD700]/40 rounded-sm bg-[#FFD700]/5 p-4" data-testid="tournament-my-stand">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-heading font-bold uppercase text-sm">Dein Stand</div>
        <StatusBadge status={myReg.status} size="lg" />
      </div>
      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {isTeamTournament ? (
          <div className="flex items-start gap-2"><Users className="w-4 h-4 text-white/50 mt-0.5" /><div><dt className="text-[10px] font-bold uppercase tracking-widest text-white/50">Team</dt><dd data-testid="tournament-my-team">{team?.name ? `${team.name}${team.tag ? ` [${team.tag}]` : ""}` : "–"}</dd></div></div>
        ) : null}
        {line ? (
          <div className="flex items-start gap-2"><Wallet className="w-4 h-4 text-white/50 mt-0.5" /><div><dt className="text-[10px] font-bold uppercase tracking-widest text-white/50">Startgeld</dt><dd data-testid="tournament-own-price">{line}</dd></div></div>
        ) : null}
        {!line && t.offer && myReg.user_id && ["pending", "waitlist"].includes(myReg.status) ? (
          <div className="flex items-start gap-2"><Wallet className="w-4 h-4 text-white/50 mt-0.5" /><div><dt className="text-[10px] font-bold uppercase tracking-widest text-white/50">Startgeld</dt><dd className="text-white/60" data-testid="tournament-price-pending">Bezahlt wird erst, wenn deine Teilnahme bestätigt ist.</dd></div></div>
        ) : null}
        {(t.check_in_from || t.check_in_until) ? (
          <div className="flex items-start gap-2"><CalendarClock className="w-4 h-4 text-white/50 mt-0.5" /><div><dt className="text-[10px] font-bold uppercase tracking-widest text-white/50">Check-in</dt><dd data-testid="tournament-my-checkin">{t.check_in_from ? `ab ${formatDateTime(t.check_in_from)}` : ""}{t.check_in_until ? ` bis ${formatDateTime(t.check_in_until)}` : ""}{staffOnlyCheckIn ? " · vor Ort bei der Turnierleitung" : ""}</dd></div></div>
        ) : null}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canCheckIn && myReg.status === "approved" && checkinOpen ? (
          <button type="button" onClick={onCheckin} disabled={busy} data-testid="tournament-checkin-btn" className="px-5 py-2.5 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#ffe45c] disabled:opacity-50">Jetzt einchecken</button>
        ) : null}
        {scheduleTo ? <Link to={scheduleTo} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">Zum Spielplan</Link> : null}
        {canUnregister ? (
          <button type="button" onClick={onUnregister} disabled={busy} data-testid="tournament-unregister-btn" className="ml-auto text-xs text-white/45 hover:text-[#FF3B30] underline underline-offset-2 disabled:opacity-50">Vom Turnier abmelden</button>
        ) : null}
      </div>
    </section>
  );
}

export default MyStandCard;
