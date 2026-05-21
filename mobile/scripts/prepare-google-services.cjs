#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "google-services.json");
const required = process.env.REQUIRE_ANDROID_PUSH_CONFIG === "1";
const raw =
  process.env.GOOGLE_SERVICES_JSON ||
  process.env.GOOGLE_SERVICES_JSON_BASE64 ||
  process.env.ANDROID_GOOGLE_SERVICES_JSON_BASE64 ||
  "";

function fail(message) {
  console.error(`Android push config error: ${message}`);
  process.exit(1);
}

if (!raw.trim()) {
  if (required) {
    fail("Missing GOOGLE_SERVICES_JSON_BASE64 or ANDROID_GOOGLE_SERVICES_JSON_BASE64. Download google-services.json from Firebase for package at.lionsquad.app and store it as a GitHub Actions secret.");
  }
  console.log("No Android google-services.json secret configured; skipping local Firebase config.");
  process.exit(0);
}

let content = raw.trim();
if (!content.startsWith("{")) {
  try {
    content = Buffer.from(content, "base64").toString("utf8");
  } catch {
    fail("Secret is neither raw JSON nor valid base64 JSON.");
  }
}

let parsed;
try {
  parsed = JSON.parse(content);
} catch {
  fail("google-services.json content is not valid JSON.");
}

const packageNames = (parsed.client || [])
  .map((client) => client?.client_info?.android_client_info?.package_name)
  .filter(Boolean);

if (!packageNames.includes("at.lionsquad.app")) {
  fail(`google-services.json does not contain Android package at.lionsquad.app. Found: ${packageNames.join(", ") || "none"}`);
}

fs.writeFileSync(output, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
console.log("Prepared mobile/google-services.json for Android Firebase/FCM push config.");
