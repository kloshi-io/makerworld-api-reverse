import { resolveMakerWorldModel } from "../src/index.js";

const liveMode = process.env.MAKERWORLD_EXAMPLE_LIVE === "1";

const urls = liveMode
  ? [
      process.env.MAKERWORLD_MODEL_URL_1 ?? "",
      process.env.MAKERWORLD_MODEL_URL_2 ?? "",
    ].filter(Boolean)
  : ["not-a-url-1", "not-a-url-2"];

const results = await Promise.all(
  urls.map(async (url) => {
    const outcome = await resolveMakerWorldModel(url, {
      request: {
        timeoutMs: 8_000,
        retries: 1,
      },
    });

    if (outcome.ok) {
      return {
        url,
        ok: true,
        profile: outcome.data.sourceProfileName,
        hours: outcome.data.sourceProfileEstimatedHours,
      };
    }

    return {
      url,
      ok: false,
      reasonCode: outcome.reasonCode,
      message: outcome.message,
    };
  }),
);

console.log(JSON.stringify(results, null, 2));
