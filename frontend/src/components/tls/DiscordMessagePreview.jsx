import { Fragment } from "react";

// Discord-Nachbildung (#583): so sieht ein Embed des Bots ungefähr im Discord aus - dunkler Kasten,
// Bot-Name mit BOT-Plakette, Farbleiste, Titel, Text, Felder, Bild, Fußzeile. Eine Annäherung; wer es
// genau wissen will, schickt die Meldung in den Testkanal. Dieselbe Komponente steht im News- und
// Event-Formular („So sieht die Meldung aus“) und auf der Vorschau unter Verbindungen → Discord.

export function embedColor(color) {
  return `#${Number(color || 0x29b6e8).toString(16).padStart(6, "0")}`;
}

/** Discords Fettschrift (**so**) und Zeilenumbrüche - mehr braucht keine unserer Meldungen. */
export function renderDiscordText(text) {
  return String(text || "").split("\n").map((line, lineIndex) => (
    <Fragment key={lineIndex}>
      {lineIndex > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) => (
        part.startsWith("**") && part.endsWith("**") && part.length > 4
          ? <strong key={partIndex} className="font-semibold text-white">{part.slice(2, -2)}</strong>
          : <Fragment key={partIndex}>{part}</Fragment>
      ))}
    </Fragment>
  ));
}

export function DiscordMessagePreview({ embed, botName = "Vereins-Bot", avatarUrl = "", time = "heute um 18:00", testId = "discord-message", embedTestId = "" }) {
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  return (
    <div className="bg-[#313338] rounded-sm p-3 text-[15px] leading-snug text-[#DBDEE1]" data-testid={testId}>
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-[#5865F2] shrink-0 overflow-hidden flex items-center justify-center text-lg" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : "🦁"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">{botName}</span>
            <span className="bg-[#5865F2] text-white text-[10px] font-bold px-1 rounded-sm leading-4">BOT</span>
            <span className="text-xs text-[#949BA4]">{time}</span>
          </div>
          <div className="mt-1 max-w-[520px] bg-[#2B2D31] rounded border-l-4 p-3" style={{ borderLeftColor: embedColor(embed?.color) }} data-testid={embedTestId || `${testId}-embed`}>
            {embed?.title && (
              embed.url
                ? <a href={embed.url} target="_blank" rel="noreferrer" className="font-semibold text-[#00A8FC] hover:underline break-words">{embed.title}</a>
                : <div className="font-semibold text-white break-words">{embed.title}</div>
            )}
            {embed?.description && <div className="mt-1 text-sm break-words">{renderDiscordText(embed.description)}</div>}
            {fields.length > 0 && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {fields.map((field, index) => (
                  <div key={`${field.name}-${index}`} className={field.inline === false ? "sm:col-span-3" : ""}>
                    <div className="text-xs font-semibold text-white">{field.name}</div>
                    <div className="text-sm">{renderDiscordText(field.value)}</div>
                  </div>
                ))}
              </div>
            )}
            {embed?.image?.url && <img src={embed.image.url} alt="" className="mt-2 rounded max-h-48 w-full object-cover" />}
            {embed?.footer?.text && <div className="mt-2 text-xs text-[#949BA4]">{embed.footer.text}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
