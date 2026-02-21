import { resolveMakerWorldModel } from "../src/index.js";

const liveMode = process.env.MAKERWORLD_EXAMPLE_LIVE === "1";
const sourceUrl =
  process.env.MAKERWORLD_MODEL_URL ??
  "https://makerworld.com/en/models/1400373-self-watering-seed-starter-with-modular-grow-kit#profileId-1452154";

if (!liveMode) {
  const dryRun = await resolveMakerWorldModel("not-a-makerworld-url");
  console.log("dry-run reasonCode:", dryRun.ok ? "resolved" : dryRun.reasonCode);
  process.exit(0);
}

const result = await resolveMakerWorldModel(sourceUrl, {
  request: {
    timeoutMs: 8_000,
    retries: 1,
  },
});

if (!result.ok) {
  console.error("resolve failed:", result.reasonCode, result.message);
  process.exit(1);
}

console.log("resolved model:", {
  title: result.data.sourceModelTitle,
  profile: result.data.sourceProfileName,
  estimatedHours: result.data.sourceProfileEstimatedHours,
  estimatedGrams: result.data.sourceProfileEstimatedGrams,
  strategy: result.data.selectionStrategy,
  downloadUrl: result.data.downloadUrl,
});
