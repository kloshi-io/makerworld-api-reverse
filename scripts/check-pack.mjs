import { execSync } from "node:child_process";

const output = execSync("npm pack --json --dry-run", {
  env: { ...process.env, npm_config_cache: ".npm-cache" },
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const parsed = JSON.parse(output);
const files = new Set((parsed?.[0]?.files ?? []).map((entry) => entry.path));

const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/makerworld.js",
  "dist/makerworld.d.ts",
  "dist/api.js",
  "dist/shared.js",
  "dist/types.js",
  "dist/constants.js",
];

for (const file of required) {
  if (!files.has(file)) {
    throw new Error(`npm pack missing required file: ${file}`);
  }
}

const forbiddenPrefixes = ["src/", "examples/", "docs/", "node_modules/"];
for (const file of files) {
  if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
    throw new Error(`npm pack should not include source-only file: ${file}`);
  }
}

console.log("npm pack dry-run checks passed.");
