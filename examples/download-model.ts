import { downloadMakerWorldModelFile } from "../src/index.js";

const liveMode = process.env.MAKERWORLD_EXAMPLE_LIVE === "1";
const downloadUrl = process.env.MAKERWORLD_DOWNLOAD_URL ?? "data:text/plain,example";

const result = await downloadMakerWorldModelFile(downloadUrl, {
  timeoutMs: 10_000,
  maxBytes: 50 * 1024 * 1024,
});

if (!liveMode) {
  console.log("dry-run download outcome:", {
    ok: result.ok,
    state: result.state,
    reasonCode: result.ok ? undefined : result.reasonCode,
  });
  process.exit(0);
}

if (!result.ok) {
  console.error("download failed:", result.reasonCode, result.message);
  process.exit(1);
}

console.log("downloaded:", {
  filename: result.filename,
  extension: result.extension,
  bytes: result.buffer.byteLength,
  finalUrl: result.finalUrl,
});
