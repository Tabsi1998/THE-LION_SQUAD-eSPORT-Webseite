/**
 * LogoTicker — ein nahtloses Logo-Laufband (#968), gemeinsam für Sponsoren und Partner.
 * Bekommt fertige Einträge (Name, Logo, Ziel) und die Kastengröße; läuft erst ab `minForMarquee`
 * Logos, darunter stehen sie zentriert. Hover hält an, „Bewegung reduzieren“ auch (index.css).
 */
import { Link } from "react-router-dom";
import { resolveMediaUrl } from "@/lib/api";
import { SmartLogo } from "@/components/tls/SmartLogo";

export function repeatForLoop(items, minItems) {
  if (!items.length) return [];
  const repeats = Math.max(1, Math.ceil(minItems / items.length));
  return Array.from({ length: repeats }, () => items).flat();
}

export function marqueeDuration(itemCount, secondsPerItem, minSeconds) {
  return Math.max(minSeconds, itemCount * secondsPerItem);
}

const MASK = "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)";

export function LogoTicker({
  items,
  boxClassFor,
  minForMarquee = 3,
  minItems = 10,
  secondsPerItem = 6,
  minSeconds = 60,
  gapClass = "gap-16",
  groupPaddingClass = "pr-16",
  verticalClass = "py-5",
  reverse = false,
  testId = "logo-ticker",
  className = "",
}) {
  const shouldMarquee = items.length >= minForMarquee;
  const loopItems = shouldMarquee ? repeatForLoop(items, minItems) : items;
  const speed = marqueeDuration(loopItems.length, secondsPerItem, minSeconds);
  const renderLogo = (item, i, groupIndex = 0, duplicate = false) => {
    const key = `${groupIndex}-${item.key}-${i}`;
    const linkClass = `inline-flex items-center justify-center shrink-0 opacity-80 hover:opacity-100 transition ${boxClassFor(item)}`;
    const logo = <SmartLogo src={resolveMediaUrl(item.logo_url)} alt={item.name} className="max-h-full max-w-full w-auto h-auto" />;
    if (item.to) {
      return <Link key={key} to={item.to} tabIndex={duplicate ? -1 : undefined} className={linkClass} title={item.name}>{logo}</Link>;
    }
    return (
      <a key={key} href={item.href || undefined} target={item.href ? "_blank" : undefined} rel="noreferrer" tabIndex={duplicate ? -1 : undefined} className={linkClass} title={item.name}>
        {logo}
      </a>
    );
  };
  return (
    <div
      className={`tls-logo-ticker relative max-w-full overflow-hidden ${className}`}
      style={shouldMarquee ? { maskImage: MASK, WebkitMaskImage: MASK } : undefined}
      data-testid={testId}
      data-marquee={shouldMarquee ? "1" : "0"}
    >
      <div
        className={`flex items-center ${verticalClass} ${shouldMarquee ? `tls-logo-ticker__track whitespace-nowrap ${reverse ? "tls-logo-ticker__track--reverse" : ""}` : `justify-center flex-wrap px-4 ${gapClass}`}`}
        style={shouldMarquee ? { "--tls-logo-ticker-speed": `${speed}s` } : undefined}
      >
        {shouldMarquee ? (
          <>
            <div className={`flex shrink-0 items-center ${gapClass} ${groupPaddingClass}`}>
              {loopItems.map((item, i) => renderLogo(item, i, 0))}
            </div>
            <div className={`flex shrink-0 items-center ${gapClass} ${groupPaddingClass}`} aria-hidden="true">
              {loopItems.map((item, i) => renderLogo(item, i, 1, true))}
            </div>
          </>
        ) : loopItems.map((item, i) => renderLogo(item, i))}
      </div>
    </div>
  );
}
