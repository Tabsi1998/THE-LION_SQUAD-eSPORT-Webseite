import { Calendar, Gamepad2, MapPin } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { formatWhen, getRegistrationState } from "@/lib/datetime";
import { gameLabel } from "@/lib/gameLabels";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";

// Vor-Ort-Zugang (#1592): Die Turnierseite für alle, die den QR-Code am TV oder am Aushang gescannt haben, das Turnier
// aber sonst nicht sehen (z. B. Begleitpersonen bei einem Mitglieder-Turnier). Am Handy, in der Halle: Titel, Termin,
// Spiel, freie Plätze und ein großer Knopf „Mitspielen“. Mehr gibt der Server hier nicht her - nach der Anmeldung zeigt
// dieselbe Adresse das ganze Turnier.

const MAX_SEAT_BOXES = 64;

export function seatsLine(tournament) {
  const max = Number(tournament?.max_participants) || 0;
  const taken = Math.max(0, Number(tournament?.participant_count) || 0);
  if (!max) return { text: taken ? `${taken} angemeldet` : "", free: null, max, taken };
  const free = Math.max(0, max - taken);
  const team = (tournament?.team_mode || "solo") !== "solo";
  if (!free) return { text: "Alle Plätze belegt – Warteliste", free, max, taken };
  return { text: `${free} von ${max} ${team ? "Teamplätzen" : "Plätzen"} frei`, free, max, taken };
}

export function OnsiteTournamentView({ tournament: t, user, loading = false, error = "", onRegister }) {
  const registration = getRegistrationState(t, "Anmeldung");
  const seats = seatsLine(t);
  const boxes = seats.max && seats.max <= MAX_SEAT_BOXES ? Array.from({ length: seats.max }, (_, index) => index < seats.taken) : [];
  const team = (t.team_mode || "solo") !== "solo";
  const cover = t.banner_url || t.game?.cover_url || "";
  return (
    <section className="relative overflow-hidden border-b border-white/10" data-testid="onsite-tournament-view">
      {cover ? (
        <div className="absolute inset-0" aria-hidden="true">
          <img src={resolveMediaUrl(cover)} alt="" width="1200" height="600" loading="eager" decoding="async" className="w-full h-full object-cover opacity-15" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/40 via-[#0A0A0A]/85 to-[#0A0A0A]" />
        </div>
      ) : null}
      <div className="relative max-w-xl mx-auto px-4 sm:px-6 pt-10 pb-12">
        <h1 className="font-heading text-4xl sm:text-5xl font-black uppercase leading-[0.95] break-words [text-wrap:balance]" data-testid="tournament-title">
          {t.title}
        </h1>

        <dl className="mt-7 divide-y divide-white/10 border-y border-white/10">
          <Fact icon={Calendar} label="Termin" testId="onsite-start">{formatWhen(t.start_date, { fallback: "Termin folgt" })}</Fact>
          {t.game ? <Fact icon={Gamepad2} label="Spiel">{gameLabel(t.game)}{team ? ` · Teams zu ${t.team_size || 2}` : ""}</Fact> : null}
          {t.location ? <Fact icon={MapPin} label="Ort">{t.location}</Fact> : null}
        </dl>

        {seats.text ? (
          <div className="mt-6">
            <div className={`font-heading text-2xl font-bold ${seats.free === 0 ? "text-[#FFD700]" : "text-[#00FF88]"}`} data-testid="onsite-seats">{seats.text}</div>
            {boxes.length ? (
              <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(16, boxes.length)}, minmax(0, 1fr))` }} aria-hidden="true">
                {boxes.map((taken, index) => (
                  <i key={index} className={`block h-2.5 rounded-[1px] ${taken ? "bg-white/20" : "bg-[#00FF88]"}`} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8">
          {registration.canRegister ? (
            <>
              <button
                type="button"
                onClick={onRegister}
                disabled={loading}
                data-testid="onsite-register-btn"
                className="tls-btn tls-btn--primary w-full min-h-[56px] px-6 rounded-sm font-heading text-xl font-black uppercase tracking-wider disabled:opacity-50"
              >
                {loading ? "Wird gesendet …" : team ? "Team anmelden" : "Mitspielen"}
              </button>
              <p className="mt-3 text-sm text-white/65">
                {user
                  ? `Du meldest dich als ${user.display_name || user.username} an. Es gelten die Turnierregeln und unsere Datenschutzerklärung.`
                  : "Zum Mitspielen brauchst du ein Konto. Melde dich an oder registriere dich – danach geht es hier weiter."}
              </p>
            </>
          ) : (
            <div className="border border-white/10 bg-[#121212] rounded-sm px-4 py-3" data-testid="onsite-closed">
              <div className="font-bold text-white">{registration.label}</div>
              <div className="mt-1 text-sm text-white/65">Frag bei der Turnierleitung vor Ort nach.</div>
            </div>
          )}
          {error ? <div className="mt-4"><AuthFormAlert id="onsite-register-error">{error}</AuthFormAlert></div> : null}
        </div>

        <p className="mt-10 text-sm text-white/50">
          Nach der Anmeldung siehst du hier das ganze Turnier: Turnierbaum, Spielplan und deine Spiele.
        </p>
      </div>
    </section>
  );
}

function Fact({ icon: Icon, label, children, testId }) {
  return (
    <div className="flex items-baseline gap-3 py-3">
      <dt className="flex w-24 shrink-0 items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/55">
        <Icon className="w-3.5 h-3.5 self-center" aria-hidden="true" /> {label}
      </dt>
      <dd className="min-w-0 text-lg text-white break-words" data-testid={testId}>{children}</dd>
    </div>
  );
}
