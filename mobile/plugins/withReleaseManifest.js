// Play-Fassung (#593): Berechtigungen, die nur Entwicklung oder der alte Sideload-Installer
// brauchten, kommen nicht in den Release-Build. React Native trägt SYSTEM_ALERT_WINDOW
// („Über anderen Apps einblenden“) für die Fehleranzeige im Debug-Build ein; Google Play zeigt
// sie sonst als Berechtigung der App. REQUEST_INSTALL_PACKAGES erlaubt Google nur App-Stores.
//
// Das Plugin legt bei `expo prebuild` eine Manifest-Ergänzung für den Build-Typ „release“ ab;
// der Manifest-Merger entfernt die beiden Einträge dort - Debug-Builds bleiben unverändert.
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

const RELEASE_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove" />
  <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" tools:node="remove" />
</manifest>
`;

module.exports = function withReleaseManifest(config) {
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const dir = path.join(modConfig.modRequest.platformProjectRoot, "app", "src", "release");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "AndroidManifest.xml"), RELEASE_MANIFEST);
      return modConfig;
    },
  ]);
};
