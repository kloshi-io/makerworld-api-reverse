import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredFiles = [
  "README.md",
  "docs/MANUAL.md",
  "docs/API.md",
  "docs/REASON_CODES.md",
  "docs/CHANGELOG_POLICY.md",
  "docs/ROADMAP.md",
  "llms.txt",
  "docs/llms-full.txt",
  "examples/basic-resolve.ts",
  "examples/download-model.ts",
  "examples/batch-import.ts",
];

for (const rel of requiredFiles) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required documentation asset: ${rel}`);
  }
}

const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

const requiredReadmeSnippets = [
  "## What This Is",
  "## What This Is Not",
  "## Quickstart",
  "## API Overview",
  "## Reason Code Matrix",
  "## Compliance And ToS Disclaimer",
  "## Facts And Guarantees",
  "## FAQ",
  "examples/basic-resolve.ts",
  "examples/download-model.ts",
  "examples/batch-import.ts",
];

for (const snippet of requiredReadmeSnippets) {
  if (!readme.includes(snippet)) {
    throw new Error(`README missing required section/link: ${snippet}`);
  }
}

console.log("Documentation structure checks passed.");
