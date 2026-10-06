import { Fragment } from "react";
import { ExternalLink } from "lucide-react";
import { asInstant, viennaDate, viennaDay, viennaTime } from "@/lib/vienna";

// Discord-Nachbildung (#583, #866): so sieht eine Nachricht des Bots ungefähr im Discord aus - Bot-Name mit
// APP-Plakette, Text über dem Kasten, Kasten mit Farbleiste, Autorzeile mit Bild, Titel, Text, Felder, Bild rechts,
// großes Bild, Fußzeile mit Symbol und Uhrzeit, darunter die Link-Knöpfe. Eine Annäherung; wer es genau wissen will,
// schickt die Meldung in den Testkanal. Dieselbe Komponente steht im News- und Event-Formular, auf der Vorschau unter
// Verbindungen → Discord und im Gestaltungs-Editor.

export function embedColor(color) {
  return `#${Number(color || 0x29b6e8).toString(16).padStart(6, "0")}`;
}

// Discords Markdown, soweit unsere Meldungen es brauchen: Escapes, fett, unterstrichen, kursiv, durchgestrichen,
// Code, Links mit Text, Adressen, Rollen-Erwähnungen.
const INLINE = /\\([\\*_~`|[\]<>#@-])|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|~~(.+?)~~|`([^`]+?)`|\[([^\]]+?)\]\((https?:\/\/[^)\s]+)\)|<@&(\d+)>|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<]+)|(@[\wÄÖÜäöüß-]+)/g;

function inline(text, keyPrefix, options) {
  const out = [];
  let last = 0;
  let index = 0;
  const source = String(text || "");
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) out.push(source.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;
    const [, escaped, bold, underline, italicStar, italicUnderscore, strike, code, linkText, linkUrl, roleId, angleUrl, bareUrl, mention] = match;
    if (escaped !== undefined) out.push(escaped);
    else if (bold !== undefined) out.push(<strong key={key} className="font-semibold text-white">{inline(bold, key, options)}</strong>);
    else if (underline !== undefined) out.push(<u key={key}>{inline(underline, key, options)}</u>);
    else if (italicStar !== undefined || italicUnderscore !== undefined) out.push(<em key={key}>{inline(italicStar ?? italicUnderscore, key, options)}</em>);
    else if (strike !== undefined) out.push(<s key={key}>{inline(strike, key, options)}</s>);
    else if (code !== undefined) out.push(<code key={key} className="rounded bg-[#1E1F22] px-1 text-[0.85em]">{code}</code>);
    else if (linkText !== undefined) out.push(<a key={key} href={linkUrl} target="_blank" rel="noreferrer" className="text-[#00A8FC] hover:underline">{inline(linkText, key, options)}</a>);
    else if (roleId !== undefined) out.push(<span key={key} className="rounded bg-[#5865F2]/30 px-0.5 font-medium text-[#C9CDFB]">@{options.roles?.[roleId] || "Rolle"}</span>);
    else if (angleUrl !== undefined || bareUrl !== undefined) {
      const url = angleUrl ?? bareUrl;
      out.push(<a key={key} href={url} target="_blank" rel="noreferrer" className="text-[#00A8FC] hover:underline break-all">{url}</a>);
    } else if (mention !== undefined) {
      out.push(options.mentions ? <span key={key} className="rounded bg-[#5865F2]/30 px-0.5 font-medium text-[#C9CDFB]">{mention}</span> : mention);
    }
    last = match.index + match[0].length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

/** Discords Text: Zeilen mit Überschriften (#, ##, ###), Aufzählungen (- ) und Zitaten (> ), darin Markdown. */
export function renderDiscordText(text, options = {}) {
  return String(text || "").split("\n").map((line, lineIndex) => {
    const key = `l${lineIndex}`;
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    let body;
    if (heading) {
      const size = { 1: "text-xl", 2: "text-lg", 3: "text-base" }[heading[1].length];
      body = <span className={`block font-bold text-white ${size}`}>{inline(heading[2], key, options)}</span>;
    } else if (bullet) {
      body = <span className="block pl-4 relative"><span className="absolute left-1" aria-hidden="true">•</span>{inline(bullet[1], key, options)}</span>;
    } else if (quote) {
      body = <span className="block border-l-4 border-[#4E5058] pl-2">{inline(quote[1], key, options)}</span>;
    } else {
      body = inline(line, key, options);
    }
    return (
      <Fragment key={key}>
        {lineIndex > 0 && !heading && !bullet && !quote && <br />}
        {body}
      </Fragment>
    );
  });
}

/** „Heute um 19:15 Uhr“ oder „03.10.2026 19:15“ - wie Discord die Zeit in der Fußzeile zeigt. */
export function discordTime(value, now = new Date()) {
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = viennaTime(date, { hour: "2-digit", minute: "2-digit" });
  return viennaDay(date) === viennaDay(now) ? `Heute um ${time} Uhr` : `${viennaDate(date, { day: "2-digit", month: "2-digit", year: "numeric" })} ${time}`;
}

export function DiscordMessagePreview({ embed, content = "", buttons = [], botName = "Vereins-Bot", avatarUrl = "", time = "heute um 18:00", roles = {}, testId = "discord-message", embedTestId = "" }) {
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  const links = Array.isArray(buttons) ? buttons.filter((button) => button?.label && button?.url) : [];
  const author = embed?.author?.name ? embed.author : null;
  const footerTime = embed?.timestamp ? discordTime(embed.timestamp) : "";
  return (
    <div className="bg-[#313338] rounded-sm p-3 text-[15px] leading-snug text-[#DBDEE1]" data-testid={testId}>
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-[#5865F2] shrink-0 overflow-hidden flex items-center justify-center text-lg" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : "🦁"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">{botName}</span>
            <span className="bg-[#5865F2] text-white text-[10px] font-bold px-1 rounded-sm leading-4">APP</span>
            <span className="text-xs text-[#949BA4]">{time}</span>
          </div>
          {content && <div className="mt-0.5 break-words" data-testid={`${testId}-content`}>{renderDiscordText(content, { roles, mentions: true })}</div>}
          {embed && (
            <div className="mt-1 max-w-[520px] bg-[#2B2D31] rounded border-l-4 p-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4" style={{ borderLeftColor: embedColor(embed?.color) }} data-testid={embedTestId || `${testId}-embed`}>
              <div className="min-w-0">
                {author && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-white" data-testid={`${testId}-author`}>
                    {author.icon_url && <img src={author.icon_url} alt="" className="w-6 h-6 rounded-full object-cover" />}
                    {author.url ? <a href={author.url} target="_blank" rel="noreferrer" className="hover:underline break-words">{author.name}</a> : <span className="break-words">{author.name}</span>}
                  </div>
                )}
                {embed?.title && (
                  embed.url
                    ? <a href={embed.url} target="_blank" rel="noreferrer" className={`block font-semibold text-[#00A8FC] hover:underline break-words ${author ? "mt-1" : ""}`}>{embed.title}</a>
                    : <div className={`font-semibold text-white break-words ${author ? "mt-1" : ""}`}>{embed.title}</div>
                )}
                {embed?.description && <div className="mt-1 text-sm break-words">{renderDiscordText(embed.description, { roles })}</div>}
                {fields.length > 0 && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {fields.map((field, index) => (
                      <div key={`${field.name}-${index}`} className={field.inline === false ? "sm:col-span-3" : ""}>
                        <div className="text-xs font-semibold text-white">{field.name}</div>
                        <div className="text-sm break-words">{renderDiscordText(field.value, { roles })}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {embed?.thumbnail?.url && (
                <img src={embed.thumbnail.url} alt="" className="w-20 h-20 rounded object-cover row-span-2" data-testid={`${testId}-thumbnail`} />
              )}
              {embed?.image?.url && <img src={embed.image.url} alt="" className="col-span-2 mt-3 rounded max-h-72 w-full object-cover" data-testid={`${testId}-image`} />}
              {(embed?.footer?.text || footerTime) && (
                <div className="col-span-2 mt-2 flex items-center gap-2 text-xs text-[#949BA4]" data-testid={`${testId}-footer`}>
                  {embed?.footer?.icon_url && <img src={embed.footer.icon_url} alt="" className="w-5 h-5 rounded-full object-cover" />}
                  <span>{[embed?.footer?.text, footerTime].filter(Boolean).join(" • ")}</span>
                </div>
              )}
            </div>
          )}
          {links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2" data-testid={`${testId}-buttons`}>
              {links.map((button) => (
                <a key={button.url} href={button.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[3px] bg-[#4E5058] hover:bg-[#6D6F78] px-4 py-1.5 text-sm font-medium text-white">
                  {button.label}
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
