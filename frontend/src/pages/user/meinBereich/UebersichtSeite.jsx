import { Link, useOutletContext } from "react-router-dom";
import { ArrowRight, CheckCircle2, KeyRound, Hash, MapPin, Receipt, Trash2 } from "lucide-react";
import { StaggerIn, Glow } from "@/components/tls/motion";
import { schnellwege } from "@/lib/meinBereichSeiten";
import { BereichListe } from "./BereichNav";
import { BereichSeite } from "./BereichSeite";
import { Identitaet } from "./MeinBereichLayout";

// Übersicht von „Mein Bereich“ (#2059): oben „Zu tun“ als große Knöpfe (offene Rechnung, Einwilligung, Nummer wählen …),
// darunter die häufigsten Wege als Knöpfe. Am Handy folgt die Liste aller Gruppen - sie ist dort die Seitenleiste.

const SCHNELL_ICONS = { nummer: Hash, anschrift: MapPin, rechnungen: Receipt, passwort: KeyRound, loeschung: Trash2 };

function ZuTunKnopf({ item }) {
  const warn = item.tone === "warn";
  const card = (
    <Link
      to={item.to}
      data-testid={`mein-bereich-todo-${item.key}`}
      className={`tls-card ${warn ? "tls-card--gold" : ""} group flex min-h-16 items-center gap-4 rounded-sm border bg-[#121212] px-4 py-3 ${warn ? "border-warn/45" : "border-[#29B6E8]/35"}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`tls-card__title tls-wrap block tls-type-card ${warn ? "text-warn" : "text-white"}`}>{item.label}</span>
        {item.detail ? <span className="tls-wrap mt-0.5 block tls-type-small text-white/60">{item.detail}</span> : null}
      </span>
      <ArrowRight className="tls-card__arrow w-5 h-5 shrink-0 text-white/40" aria-hidden="true" />
    </Link>
  );
  return <li className="min-w-0">{warn ? <Glow active tone="honor">{card}</Glow> : card}</li>;
}

export default function UebersichtSeite() {
  const { todo, offen, gruppen, mitglied, user } = useOutletContext();
  const items = todo.items;
  return (
    <BereichSeite title="Mein Bereich" docTitle="Übersicht" intro="Alles, was dich betrifft – an einem Ort." back={false} testId="mein-bereich-start">
      <div className="lg:hidden mb-6"><Identitaet user={user} /></div>

      <section aria-labelledby="mein-bereich-todo-title" data-testid="mein-bereich-todo">
        <h2 id="mein-bereich-todo-title" className="tls-type-section">Zu tun</h2>
        {!todo.loaded ? (
          <div className="mt-3 h-16 rounded-sm border border-white/10 bg-[#121212] animate-pulse motion-reduce:animate-none" data-testid="mein-bereich-todo-loading" />
        ) : items.length ? (
          <StaggerIn as="ul" className="mt-3 grid gap-3">
            {items.map((item) => <ZuTunKnopf key={item.key} item={item} />)}
          </StaggerIn>
        ) : (
          <p className="mt-3 flex items-center gap-2 rounded-sm border border-white/10 bg-[#121212] px-4 py-4 tls-type-small text-white/70" data-testid="mein-bereich-todo-empty">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-ok" aria-hidden="true" /> Alles erledigt – gerade ist nichts offen.
          </p>
        )}
      </section>

      <section aria-labelledby="mein-bereich-schnell-title" className="mt-8" data-testid="mein-bereich-schnell">
        <h2 id="mein-bereich-schnell-title" className="tls-type-section">Häufig gebraucht</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {schnellwege({ mitglied }).map((item) => {
            const Icon = SCHNELL_ICONS[item.key];
            return (
              <Link key={item.key} to={item.to} data-testid={`mein-bereich-schnell-${item.key}`} className={`tls-type-label tls-btn ${item.key === "loeschung" ? "tls-btn--quiet" : "tls-btn--secondary"} inline-flex min-h-11 items-center gap-2 rounded-sm px-4 py-2`}>
                {Icon ? <Icon className="w-3.5 h-3.5" aria-hidden="true" /> : null} {item.label}
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="mein-bereich-alle-title" className="mt-8 lg:hidden">
        <h2 id="mein-bereich-alle-title" className="tls-type-section">Alle Bereiche</h2>
        <div className="mt-3"><BereichListe gruppen={gruppen.filter((item) => item.key !== "start")} offen={offen} /></div>
      </section>
    </BereichSeite>
  );
}
