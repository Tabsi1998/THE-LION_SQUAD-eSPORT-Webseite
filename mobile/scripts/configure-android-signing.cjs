const fs = require("fs");
const path = require("path");

const gradlePath = path.join(__dirname, "..", "android", "app", "build.gradle");

if (!fs.existsSync(gradlePath)) {
  throw new Error(`Android Gradle file not found: ${gradlePath}`);
}

let source = fs.readFileSync(gradlePath, "utf8");

if (!source.includes("TLS_UPLOAD_STORE_FILE")) {
  source = source.replace(
    /signingConfigs\s*\{\s*\r?\n/,
    (match) => `${match}        release {
            if (project.hasProperty('TLS_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('TLS_UPLOAD_STORE_FILE'))
                storePassword findProperty('TLS_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('TLS_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('TLS_UPLOAD_KEY_PASSWORD')
            }
        }
`
  );
}

const debugSigning = "signingConfig signingConfigs.debug";
const lastDebugSigning = source.lastIndexOf(debugSigning);

if (lastDebugSigning === -1) {
  if (!source.includes("signingConfig signingConfigs.release")) {
    throw new Error("Could not find the release build signingConfig to update.");
  }
} else {
  source =
    source.slice(0, lastDebugSigning) +
    "signingConfig signingConfigs.release" +
    source.slice(lastDebugSigning + debugSigning.length);
}

fs.writeFileSync(gradlePath, source);
