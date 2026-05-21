const fs = require("fs");
const path = require("path");

const config = require("./app.json");

const googleServicesFile = process.env.GOOGLE_SERVICES_FILE || "./google-services.json";
const googleServicesPath = path.resolve(__dirname, googleServicesFile);

if (fs.existsSync(googleServicesPath)) {
  config.expo.android = {
    ...(config.expo.android || {}),
    googleServicesFile,
  };
}

module.exports = config;
