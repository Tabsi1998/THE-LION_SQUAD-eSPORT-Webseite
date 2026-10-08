import { Link } from "react-router-dom";
import { Gamepad2, User as UserIcon } from "lucide-react";
import { SizedImage } from "@/components/tls/SizedImage";

// Vorstands-Porträts aus einem Guss (#1332): alle im selben Hochformat (3 : 4, Kopf und Schultern). Ist das Foto
// freigestellt (beim Hochladen erkannt, `photo_cutout`), legt die Website den Vereins-Hintergrund mit Löwe dahinter;
// sonst steht das Foto im Duoton (grau, cyan getönt). Darunter die Rolle als Etikett in der Form der Person, der echte
// Name groß und der Spielername klein mit Controller - ist kein echter Name freigegeben, steht der Spielername groß.
// Klein (rund, 64 px) für Ansprechpartner auf „Über uns“ und im Mitgliederbereich. Der Löwe und die Schrift-Stufen
// kommen später aus dem Stil-System (Meilenstein 84); bis dahin der Löwe als leises Bild im Hintergrund (CSS).
// Die Bilder kommen in passender Größe (#1227): groß höchstens 280 px breit, klein rund 64 px - der Browser bekommt nur
// die Fassungen angeboten, die dazu passen. Lädt ein Foto nicht, steht der leere Hintergrund mit Löwe da.

// Wie breit ein Porträt gezeigt wird: am Handy zwei je Reihe, ab Tablet höchstens 280 bzw. 220 px.
export const PORTRAIT_SIZES = { lg: "(min-width: 640px) 280px, 50vw", sm: "(min-width: 640px) 220px, 50vw" };
export const AVATAR_SIZE = 64;

/** Name groß und klein: echter Name groß, Spielername klein - ohne echten Namen der Spielername groß. */
export function personNames(person) {
  if (!person) return { primary: "", secondary: "" };
  const gamertag = person.gamertag || person.username || person.display_name || "";
  const real = person.real_name || (person.display_name && person.display_name !== gamertag ? person.display_name : "");
  return real ? { primary: real, secondary: gamertag && gamertag !== real ? gamertag : "" } : { primary: gamertag, secondary: "" };
}

/** Lange Rollen in Etikett und Wort statt „…“: „Stellvertretung“ / „Obmann“. */
export function splitRole(title) {
  const text = String(title || "").trim();
  const before = /^(stellvertretung|stellvertreter(?:in)?|stv\.?)\s+(?:der\s+|des\s+)?(.+)$/i.exec(text);
  if (before) return { label: "Stellvertretung", word: before[2] };
  const after = /^(.+?)[-\s](stellvertretung|stellvertreter(?:in)?|stv\.?)$/i.exec(text);
  if (after) return { label: "Stellvertretung", word: after[1] };
  return { label: text, word: "" };
}

/** Lange Rollen dürfen nach „/“ und „:“ umbrechen („Jugendreferent:“ / „in“) statt mitten im Wort. */
export function softBreaks(text) {
  return String(text || "").replace(/([/:])(?=\S)/g, "$1\u200B");
}

/**
 * Das Bild: freigestellt auf dem Vereins-Hintergrund, sonst im Duoton; ohne Foto der leere Hintergrund mit Löwe.
 * `size`: rund in festen Pixeln (Ansprechpartner); sonst `sizes` - wie breit das Hochformat gezeigt wird.
 */
export function PortraitImage({ photo, cutout, round = false, size, sizes = PORTRAIT_SIZES.lg, className = "", testId }) {
  const club = Boolean(cutout) || !photo;
  const empty = <UserIcon className="tls-portrait__empty" aria-hidden="true" />;
  return (
    <span className={`tls-portrait ${club ? "tls-portrait--club" : "tls-portrait--duo"} ${round ? "tls-portrait--round" : ""} ${className}`} data-testid={testId} data-look={!photo ? "empty" : club ? "club" : "duotone"}>
      {photo ? (size ? <SizedImage src={photo} size={size} alt="" className="tls-portrait__img" fallback={empty} /> : <SizedImage src={photo} sizes={sizes} alt="" className="tls-portrait__img" fallback={empty} />) : empty}
    </span>
  );
}

function RoleLine({ label, word, quiet = false }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 min-w-0">
      <span lang="de" className={`text-[11px] font-bold uppercase tracking-[0.18em] break-words hyphens-auto ${quiet ? "text-white/55" : "text-[#FFD700]"}`}>{softBreaks(label)}</span>
      {word ? <span lang="de" className="text-xs font-bold text-white/75 break-words hyphens-auto">{softBreaks(word)}</span> : null}
    </span>
  );
}

/**
 * Großes Porträt mit Rolle und Namen. `person` ist der Inhaber (oder null), `title` die Rolle in seiner Form,
 * `label` ein festes Etikett (z. B. „Stellvertretung“) vor dem Wort `title`. `withheld`: Funktion besetzt, Name
 * nicht freigegeben.
 */
export function BoardPortrait({ person, title, label = "", withheld = false, size = "lg", since = "", testId }) {
  const role = label ? { label, word: title } : splitRole(title);
  const names = personNames(person);
  const target = person?.profile_url || (person?.username ? `/u/${person.username}` : null);
  const Wrapper = target ? Link : "div";
  const photo = person?.photo_url || person?.avatar_url || "";
  return (
    <Wrapper {...(target ? { to: target } : {})} data-testid={testId} data-season-anchor="card"
      className={`tls-card group flex flex-col min-w-0 w-full border border-white/10 rounded-sm bg-[#101214] overflow-hidden ${size === "lg" ? "max-w-[280px]" : "max-w-[220px]"}`}>
      <PortraitImage photo={photo} cutout={person?.photo_cutout} sizes={PORTRAIT_SIZES[size] || PORTRAIT_SIZES.lg} className="w-full tls-card__media" testId={testId ? `${testId}-image` : undefined} />
      <span className={`flex flex-col gap-1 ${size === "lg" ? "p-4" : "p-3"}`}>
        <RoleLine label={role.label} word={role.word} />
        {person ? (
          <>
            <span className={`tls-card__title font-heading font-black leading-tight break-words ${size === "lg" ? "text-lg md:text-xl" : "text-base"}`}>{names.primary}</span>
            {names.secondary ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/55 min-w-0">
                <Gamepad2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> <span className="break-all">{names.secondary}</span>
              </span>
            ) : null}
            {since ? <span className="text-[11px] text-white/40">seit {since}</span> : null}
          </>
        ) : (
          <span className="text-sm text-white/50">{withheld ? "Name nicht freigegeben" : "Position offen"}</span>
        )}
      </span>
    </Wrapper>
  );
}

/** Offene Funktion als Einladung (#1252): leeres Porträt mit Löwe, „Wir suchen …“, ein Satz zum Aufwand, „Interesse melden“. */
export function VacancyPortrait({ title, label = "", text = "", size = "lg", testId }) {
  const role = label ? `${label} ${title}`.trim() : title;
  const contact = `/contact?topic=volunteer&subject=${encodeURIComponent(`Interesse: ${role}`)}`;
  return (
    <div data-testid={testId} data-season-anchor="card" className={`tls-card flex flex-col min-w-0 w-full border border-dashed border-[#29B6E8]/40 rounded-sm bg-[#0B1418] overflow-hidden ${size === "lg" ? "max-w-[280px]" : "max-w-[220px]"}`}>
      <PortraitImage photo="" cutout className="w-full" />
      <div className={`flex flex-col gap-2 flex-1 ${size === "lg" ? "p-4" : "p-3"}`}>
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#29B6E8]">Wir suchen</span>
        <span lang="de" className="font-heading font-black leading-tight break-words hyphens-auto text-sm sm:text-base md:text-lg">{softBreaks(role)}</span>
        {text ? <p className="text-sm text-white/65">{text}</p> : null}
        <Link to={contact} data-testid={testId ? `${testId}-contact` : undefined} className="tls-btn tls-btn--secondary mt-auto inline-flex w-full justify-center px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
          Interesse melden
        </Link>
      </div>
    </div>
  );
}

/** Klein und rund (64 px) für Ansprechpartner: Bild, Rolle, Name. */
export function BoardAvatar({ contact, testId, quiet = false }) {
  const role = splitRole(contact.title);
  const Wrapper = contact.profileUrl ? Link : "div";
  return (
    <Wrapper {...(contact.profileUrl ? { to: contact.profileUrl } : {})} data-testid={testId} className="group flex items-center gap-3 min-w-0">
      <PortraitImage photo={contact.avatar} cutout={contact.cutout} round size={AVATAR_SIZE} className="w-16 h-16 shrink-0" />
      <span className="min-w-0 flex flex-col gap-0.5">
        <RoleLine label={role.label} word={role.word} quiet={quiet} />
        <span className="font-bold text-white leading-tight break-words group-hover:text-[#29B6E8] transition">{contact.name}</span>
        {contact.gamertag ? <span className="inline-flex items-center gap-1 text-xs text-white/50"><Gamepad2 className="w-3 h-3" aria-hidden="true" /> {contact.gamertag}</span> : null}
      </span>
    </Wrapper>
  );
}
