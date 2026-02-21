# Manual

## Audience

This manual is for engineers integrating `makerworld-api-reverse` into checkout/import flows, print pipelines, or content ingestion jobs.

## Resolver Pipeline Internals

### Stage 1: Source URL normalization

`resolveMakerWorldModel(sourceUrl, options?)` performs strict URL validation:

- Requires `https`
- Requires host `makerworld.com` (or subdomain)
- Requires `/model/` or `/models/` path segment
- Extracts `designId` from URL path
- Extracts optional requested variant from hash (`#profileId-<id>`)

Invalid or unsupported input returns:

- `ok: false`
- `state: "unresolvable"`
- `reasonCode: "invalid_url"`

### Stage 2: API-first resolution

Resolver calls MakerWorld internal design-service endpoints:

1. `GET /design/{designId}`
2. `GET /design/{designId}/instances`
3. Optional enrichment: `GET /profile/{profileId}`
4. Optional model URL refinement: `GET /instance/{instanceId}/f3mf`
5. Optional model fallback URL: `GET /design/{designId}/model`

Candidate variants are built from detected IDs, printer/material text, estimated hours/grams, and potential download URL hints.

### Stage 3: Variant selection strategy

Selection precedence:

1. URL hash requested variant (`requested_variant_id`)
2. Explicit caller override (`user_selected_variant`)
3. Shortest-time fallback (`shortest_time_fallback`)

Strict mode attempts printer compatibility with configured aliases first. If strict candidates are unavailable, resolver can relax to best available metrics (`profileResolutionMode: "relaxed_printer"`) with warnings.

### Stage 4: Fallback to `__NEXT_DATA__`

If API route fails or payload is malformed:

1. Fetch model page HTML
2. Parse `__NEXT_DATA__`
3. Extract candidate instance/profile arrays
4. Re-run mapping/selection logic

### Stage 5: Typed result output

Resolver returns either:

- `ok: true`, `state: "resolved"`, with `data` and `diagnostics`
- `ok: false`, `state: "unresolvable"`, with `reasonCode`, `message`, and `diagnostics`

No business-error throws are required for normal consumer usage.

## Endpoint Mapping

Base URL: `https://makerworld.com/v1/design-service`

| Endpoint | Role |
| --- | --- |
| `/design/{designId}` | title and design-level metadata |
| `/design/{designId}/instances` | variant/profile candidates |
| `/profile/{profileId}` | enrichment for missing metrics/material/printer |
| `/instance/{instanceId}/f3mf` | variant-specific downloadable asset URL hints |
| `/design/{designId}/model` | design-level fallback model URL hints |

## Timeout / Retry Behavior

### Resolver request options

Pass request-level options via resolver:

```ts
await resolveMakerWorldModel(url, {
  request: {
    timeoutMs: 8_000,
    retries: 1,
    headers: {
      "x-custom-client": "my-integrator",
    },
  },
});
```

- `timeoutMs`: positive integer; fallback to default when invalid
- `retries`: non-negative integer; fallback to default when invalid
- `headers`: merged into default upstream headers

### Download options

```ts
await downloadMakerWorldModelFile(downloadUrl, {
  timeoutMs: 20_000,
  maxBytes: 50 * 1024 * 1024,
  headers: {
    "x-download-client": "my-integrator",
  },
});
```

- `maxBytes` defaults to project upload cap if omitted
- Unsupported format/oversized resources return typed unavailable outcomes

## Troubleshooting Playbook

### `invalid_url`

- Confirm URL points to a MakerWorld model page (`/models/<id>-...`)
- Strip redirects or tracking wrappers before resolution

### `upstream_blocked`

- Respect request pacing
- Retry with backoff
- Monitor provider policy changes

### `malformed_payload`

- Capture payload sample in issue report
- Add fixture and parser regression tests
- Verify if upstream field names changed

### `missing_profile_metrics`

- Ask user to choose another variant/profile
- Fall back to direct STL/OBJ/3MF upload path

### `unsupported_model_format`

- Confirm content type and file extension
- Prefer direct print-file upload where format is known

## Operational Caveats

- Reverse-engineered behavior can break on upstream changes.
- `__NEXT_DATA__` shape is not guaranteed stable.
- Compatibility heuristics are best effort; always expose import warnings to end users.
- Keep tests updated with representative payload fixtures from real models.

## Production Integration Checklist

- Store `reasonCode`, `message`, and `diagnostics` for observability.
- Surface user-facing fallback path when resolver returns `ok: false`.
- Implement retry/backoff around transient network errors.
- Pin package versions and follow changelog updates before minor upgrades.
