#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const platform = process.argv[2];
const rawApiUrl = process.argv[3] || process.env.VITE_API_URL || process.env.MOBILE_API_URL;

const validPlatforms = new Set(["android", "ios"]);

if (!validPlatforms.has(platform)) {
  console.error(
    "Usage: npm run build:android:prod -- https://your-backend.onrender.com\n" +
      "   or: npm run build:ios:prod -- https://your-backend.onrender.com"
  );
  process.exit(1);
}

if (!rawApiUrl) {
  console.error(
    "Missing backend URL.\n" +
      "Pass it as an argument, for example:\n" +
      "npm run build:android:prod -- https://your-backend.onrender.com"
  );
  process.exit(1);
}

let parsedApiUrl;
try {
  parsedApiUrl = new URL(rawApiUrl.trim());
} catch {
  console.error(`Invalid URL "${rawApiUrl}". Use a public HTTPS base URL.`);
  process.exit(1);
}

if (parsedApiUrl.protocol !== "https:") {
  console.error(`Invalid URL "${rawApiUrl}". Use a public HTTPS base URL.`);
  process.exit(1);
}

const normalizedApiUrl = parsedApiUrl.origin;
if (normalizedApiUrl !== rawApiUrl.trim()) {
  console.warn(`Normalizing API URL to origin-only value: ${normalizedApiUrl}`);
}

const scriptName = platform === "android" ? "build:android" : "build:ios";
console.log(`Building ${platform} with VITE_API_URL=${normalizedApiUrl}`);

const result = spawnSync("npm", ["run", scriptName], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_API_URL: normalizedApiUrl
  }
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
