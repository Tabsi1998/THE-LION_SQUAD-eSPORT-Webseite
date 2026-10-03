import { useLocation } from "react-router-dom";
import { useSeason } from "./SeasonContext";
import { isQuietPath, useSeasonModules } from "./SeasonStage";
import { SoundToggle } from "./SoundToggle";

// Drei Plätze im Layout (#634, #852): das Widget neben dem Logo (klickbar, mit Tastatur erreichbar), die Deko im Footer
// und ganz oben im Handy-Menü die Einstiege, für die im Kopf am Handy kein Platz ist (Adventkalender, Nikolaus). Alle
// zeigen nur, was die Bühne auch zeigt.

function useMountedSeasons() {
  const { seasons, ready, preview } = useSeason();
  const location = useLocation();
  const active = ready && (preview || !isQuietPath(location.pathname)) ? seasons.filter((season) => season.effective !== "off") : [];
  const modules = useSeasonModules(active);
  return active.filter((season) => modules[season.key]).map((season) => ({ season, module: modules[season.key] }));
}

export function SeasonWidgetSlot() {
  const mounted = useMountedSeasons();
  const { scaresAllowed } = useSeason();
  const withWidget = mounted.filter(({ module }) => module.Widget);
  // Der Klang-Schalter (#679) steht neben dem Widget, sobald eine Saison mit Klängen läuft - nicht bei „dezent“.
  const withSounds = mounted.some(({ season, module }) => module.sounds && season.effective !== "subtle");
  // Der Schreck-Schalter (#680) nur für Personen, die Schrecken bekommen dürften (ab 18, Server-Flag).
  const scareToggles = scaresAllowed ? mounted.filter(({ season, module }) => module.ScareToggle && season.effective !== "subtle") : [];
  if (!withWidget.length && !withSounds && !scareToggles.length) return null;
  return (
    <div className="tls-season-widget-slot" data-testid="season-widget-slot">
      {withWidget.map(({ season, module }) => {
        const Widget = module.Widget;
        return <Widget key={season.key} season={season} />;
      })}
      {withSounds && <SoundToggle />}
      {scareToggles.map(({ season, module }) => {
        const Toggle = module.ScareToggle;
        return <Toggle key={`${season.key}-scare`} />;
      })}
    </div>
  );
}

/** Ganz oben im Handy-Menü (#852): je Saison mit `MenuEntry` ein Eintrag - ein Klick und man ist dort. */
export function SeasonMenuSlot({ onClose }) {
  const mounted = useMountedSeasons().filter(({ module }) => module.MenuEntry);
  if (!mounted.length) return null;
  return (
    <div className="flex flex-col gap-1 pb-3 mb-2 border-b border-white/10" data-testid="season-menu-slot">
      {mounted.map(({ season, module }) => {
        const Entry = module.MenuEntry;
        return <Entry key={season.key} season={season} onClose={onClose} />;
      })}
    </div>
  );
}

export function SeasonFooterSlot() {
  const mounted = useMountedSeasons();
  const withFooter = mounted.filter(({ module }) => module.Footer);
  if (!withFooter.length) return null;
  // Deko bleibt für Screenreader unsichtbar. Eine Szene mit eigener Bedienung (`footerAccessible`, der
  // Nikolausstiefel #736) sagt selbst, was sie ist - ihr Knopf darf nicht in einem versteckten Bereich liegen.
  const decorative = withFooter.filter(({ module }) => !module.footerAccessible);
  const accessible = withFooter.filter(({ module }) => module.footerAccessible);
  const render = ({ season, module }) => {
    const Footer = module.Footer;
    return <Footer key={season.key} season={season} />;
  };
  if (!accessible.length) {
    return (
      <div className="tls-season-footer-slot" aria-hidden="true" data-testid="season-footer-slot">
        {decorative.map(render)}
      </div>
    );
  }
  return (
    <div className="tls-season-footer-slot" data-testid="season-footer-slot">
      {decorative.length > 0 && <div className="tls-season-footer-deco" aria-hidden="true">{decorative.map(render)}</div>}
      {accessible.map(render)}
    </div>
  );
}
