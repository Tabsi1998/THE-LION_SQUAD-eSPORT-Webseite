// Play-Hinweis „DEX-Codeoptimierung“ (#917): Google wertet ab, wenn der Release-Build nicht verkleinert und
// verschleiert ist (unter 25 % kann es Sichtbarkeit und Veröffentlichung kosten, Frist Februar 2027). Expos
// Android-Vorlage liest dafür zwei Gradle-Schalter; dieses Plugin setzt sie bei `expo prebuild`. R8 wirft
// ungenutzten Code hinaus und kürzt Namen, „shrinkResources“ ungenutzte Ressourcen. Debug-Builds bleiben gleich.
//
// Die Zuordnung der gekürzten Namen (mapping.txt) legt das Release-Skript neben das Bundle und lädt sie mit ihm
// zu Google, damit Abstürze in der Play Console lesbar bleiben; Crashlytics bekommt sie über sein Gradle-Plugin.
const { withGradleProperties } = require("expo/config-plugins");

const SETTINGS = {
  "android.enableMinifyInReleaseBuilds": "true",
  "android.enableShrinkResourcesInReleaseBuilds": "true",
};

function applySettings(properties) {
  for (const [key, value] of Object.entries(SETTINGS)) {
    const existing = properties.find((item) => item.type === "property" && item.key === key);
    if (existing) existing.value = value;
    else properties.push({ type: "property", key, value });
  }
  return properties;
}

function withReleaseOptimization(config) {
  return withGradleProperties(config, (modConfig) => {
    modConfig.modResults = applySettings(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withReleaseOptimization;
module.exports.applySettings = applySettings;
module.exports.SETTINGS = SETTINGS;
