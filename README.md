# MakerWorld API Reverse

`makerworld-api-reverse` is an unofficial **MakerWorld API reverse engineering** toolkit for Node.js/TypeScript. It provides a production-ready **MakerWorld profile resolver** and **MakerWorld model downloader** for `3mf`, `stl`, and `obj` workflows. The package is designed for reliability, typed outcomes, and clear failure handling when MakerWorld upstream payloads change.

> Status: Active, community-driven, and intentionally conservative about compliance messaging.

## What This Is

- A typed library for resolving MakerWorld model pages into usable profile/variant metadata.
- An API-first resolver with fallback to `__NEXT_DATA__` parsing.
- A downloader that validates file type and size limits.
- A non-throwing outcome model (`ok: true/false`) for safe integrations.

## What This Is Not

- Not an official MakerWorld SDK.
- Not affiliated with or endorsed by MakerWorld or Bambu Lab.
- Not a bypass or automation system for restricted/private endpoints.

## Why This Project Exists

MakerWorld pages expose valuable print profile information, but robust integration requires stable extraction logic, fallback behavior, and explicit reason codes. This project packages that work into a reusable library with tests and contributor-friendly workflows.

## Quickstart

```bash
npm install makerworld-api-reverse
```

```ts
import { resolveMakerWorldModel, downloadMakerWorldModelFile } from "makerworld-api-reverse";

const resolved = await resolveMakerWorldModel(
  "https://makerworld.com/en/models/1400373-self-watering-seed-starter#profileId-1452154",
  {
    request: {
      timeoutMs: 8_000,
      retries: 1,
    },
  },
);

if (!resolved.ok) {
  console.error(resolved.reasonCode, resolved.message);
  process.exit(1);
}

console.log(resolved.data.sourceProfileName, resolved.data.sourceProfileEstimatedHours);

if (resolved.data.downloadUrl) {
  const downloaded = await downloadMakerWorldModelFile(resolved.data.downloadUrl);
  if (downloaded.ok) {
    console.log(downloaded.filename, downloaded.extension, downloaded.buffer.byteLength);
  }
}
```

## API Overview

| Function | Purpose | Success State | Failure State |
| --- | --- | --- | --- |
| `resolveMakerWorldModel(sourceUrl, options?)` | Resolve model/profile/variant metadata from MakerWorld URL | `ok: true`, `state: "resolved"` | `ok: false`, `state: "unresolvable"` |
| `downloadMakerWorldModelFile(downloadUrl, options?)` | Download and validate model asset format/size | `ok: true`, `state: "downloaded"` | `ok: false`, `state: "unavailable"` |

## Resolver Pipeline

1. Parse and validate URL.
2. Resolve by MakerWorld `v1/design-service` endpoints.
3. Enrich missing profile details where required.
4. Select variant by explicit hash/user selection/shortest-time fallback.
5. Fallback to page `__NEXT_DATA__` if API path fails.

## Reason Code Matrix

| Reason Code | Meaning | Typical Action |
| --- | --- | --- |
| `invalid_url` | URL is not a valid MakerWorld model page | Prompt user for canonical MakerWorld model URL |
| `not_found` | Upstream resource does not exist | Verify model ID or remove stale links |
| `upstream_blocked` | Upstream denied request (`401/403/429`) | Retry later, reduce request rate, monitor policy changes |
| `timeout` | Upstream request exceeded timeout | Increase timeout or retry budget |
| `malformed_payload` | Upstream payload shape changed or invalid | Update parser and add regression fixtures |
| `network_error` | Transport-level failure | Retry and inspect network logs |
| `missing_profile_metrics` | No usable print metrics for chosen variant | Ask user to choose another variant/upload file |
| `download_unavailable` | Download fetch failed/oversized asset | Retry or use manual download path |
| `unsupported_model_format` | Unknown extension/content type | Upload STL/OBJ/3MF directly |

## Facts And Guarantees

- Public API is additive-first; breaking changes require a major version.
- Core resolver/downloader return typed non-throwing outcomes.
- Unit tests cover API-first flow, fallback flow, malformed payload resilience, and download edge cases.
- Current default printer compatibility cluster targets Bambu Lab core XY family (including P2S/P1S/P1P/X1C aliases).

## Compliance And ToS Disclaimer

This repository documents and implements reverse-engineered behavior for interoperability. You are responsible for using it in ways that comply with MakerWorld Terms of Service, local law, and organizational policy. Do not use this project to bypass access controls, restrictions, or private resources.

## Stability And Versioning

- Versioning: semantic versioning (`MAJOR.MINOR.PATCH`).
- Compatibility policy: additive changes in minor versions; breaking shape changes only in major versions.
- Changelog policy: see [`docs/CHANGELOG_POLICY.md`](docs/CHANGELOG_POLICY.md).

## Documentation

- Manual: [`docs/MANUAL.md`](docs/MANUAL.md)
- API reference: [`docs/API.md`](docs/API.md)
- Reason codes: [`docs/REASON_CODES.md`](docs/REASON_CODES.md)
- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- LLM index: [`llms.txt`](llms.txt)

## Examples

- [`examples/basic-resolve.ts`](examples/basic-resolve.ts)
- [`examples/download-model.ts`](examples/download-model.ts)
- [`examples/batch-import.ts`](examples/batch-import.ts)

Run docs/example checks locally:

```bash
npm run test:docs
npm run test:examples
```

## Contributing

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), then open an issue or pull request.

## FAQ

### Is this an official MakerWorld API SDK?
No. It is an unofficial community project.

### Can I download 3MF files from MakerWorld models?
Yes, when a resolvable download URL is exposed by upstream payloads and the format can be validated.

### Does `#profileId-<id>` in URL hash matter?
Yes. The resolver prioritizes hash variant selection as `requested_variant_id` when metrics are available.

### What happens if internal API payloads change?
The resolver falls back to `__NEXT_DATA__` parsing. If both paths fail, you get a typed unresolvable outcome with a reason code.

### Does this support only one printer model?
By default, strict compatibility targets configured printer aliases centered on Bambu Lab P2S compatibility rules.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
