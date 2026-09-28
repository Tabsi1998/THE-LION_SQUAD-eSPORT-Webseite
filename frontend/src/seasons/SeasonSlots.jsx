import { useLocation } from "react-router-dom";
import { useSeason } from "./SeasonContext";
import { isQuietPath, useSeasonModules } from "./SeasonStage";
import { SoundToggle } from "./SoundToggle";

// Zwei Plätze im Layout (#634): das Widget neben dem Logo (klickbar, mit Tastatur erreichbar) und die
// Deko im Footer. Beide zeigen nur, was die Bühne auch zeigt.

function useMountedSeasons() {
  const { seasons, ready, preview } = useSeason();
  const location = useLocation();
  const active = ready && (preview || !isQuietPath(location.pathname)) ? seasons.filter((season) => season.effective !== "off") : [];
  const modules = useSeasonModules(active);
  return active.filter((season) => modules[season.key]).map((season) => ({ season, module: modules[season.key] }));
}

export function SeasonWidgetSlot() {
  const mounted = useMountedSeasons();
  const withWidget = mounted.filter(({ module }) => module.Widget);
  // Der Klang-Schalter (#679) steht neben dem Widget, sobald eine Saison mit Klängen läuft - nicht bei „dezent“.
  const withSounds = mounted.some(({ season, module }) => module.sounds && season.effective !== "subtle");
  if (!withWidget.length && !withSounds) return null;
  return (
    <div className="tls-season-widget-slot" data-testid="season-widget-slot">
      {withWidget.map(({ season, module }) => {
        const Widget = module.Widget;
        return <Widget key={season.key} season={season} />;
      })}
      {withSounds && <SoundToggle />}
    </div>
  );
}

export function SeasonFooterSlot() {
  const mounted = useMountedSeasons();
  const withFooter = mounted.filter(({ module }) => module.Footer);
  if (!withFooter.length) return null;
  return (
    <div className="tls-season-footer-slot" aria-hidden="true" data-testid="season-footer-slot">
      {withFooter.map(({ season, module }) => {
        const Footer = module.Footer;
        return <Footer key={season.key} season={season} />;
      })}
    </div>
  );
}
