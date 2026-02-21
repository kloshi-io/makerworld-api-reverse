# MakerWorld API Reverse (Extracted)

Standalone extraction of the MakerWorld reverse-engineered resolver/downloader from this project.

## What it does

- Resolves MakerWorld model URLs to profile/variant data.
- Uses MakerWorld internal `v1/design-service` endpoints first.
- Falls back to parsing `__NEXT_DATA__` from model pages when API resolution fails.
- Downloads model files and validates supported formats (`stl`, `obj`, `3mf`).
- Returns typed non-throwing outcomes for resolver and downloader.

## Endpoints used

Base: `https://makerworld.com/v1/design-service`

- `GET /design/{designId}`
- `GET /design/{designId}/instances`
- `GET /profile/{profileId}`
- `GET /instance/{instanceId}/f3mf`
- `GET /design/{designId}/model`

## Install

```bash
npm install
```

## Test

```bash
npm test
```

## Build

```bash
npm run build
```

## Usage

```ts
import { resolveMakerWorldModel, downloadMakerWorldModelFile } from "makerworld-api-reverse";

const resolved = await resolveMakerWorldModel(
  "https://makerworld.com/en/models/123456-sample#profileId-123456",
);

if (resolved.ok && resolved.data.downloadUrl) {
  const downloaded = await downloadMakerWorldModelFile(resolved.data.downloadUrl);
  if (downloaded.ok) {
    console.log(downloaded.filename, downloaded.extension, downloaded.buffer.byteLength);
  }
}
```

## Notes

- This package is based on reverse engineering and can break if upstream payloads change.
- Review MakerWorld terms/policies before publishing and using this in production.
