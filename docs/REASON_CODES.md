# Reason Codes

`MakerWorldReasonCode` values are returned by resolver/downloader failure outcomes.

| Reason Code | Surface | Meaning | Suggested Handling |
| --- | --- | --- | --- |
| `invalid_url` | resolve | Source URL is not a valid MakerWorld model URL | Request corrected URL |
| `not_found` | resolve/download | Upstream returned 404 | Inform user link no longer exists |
| `upstream_blocked` | resolve | Upstream returned auth/rate-limit style denial | Retry with backoff; reduce request rate |
| `timeout` | resolve/download | Request exceeded timeout budget | Retry, or increase timeout settings |
| `malformed_payload` | resolve | Upstream payload changed or invalid JSON/shape | Collect sample payload and update parser |
| `network_error` | resolve | Connection-level failure | Retry and inspect networking |
| `incompatible_profile` | resolve | Candidate profile incompatible with strict resolution | Present alternate variants/upload fallback |
| `missing_profile_metrics` | resolve | Profile candidates exist but lack usable metrics | Request different variant/upload fallback |
| `download_unavailable` | download | Download failed or asset too large | Retry or switch to manual upload flow |
| `unsupported_model_format` | download | Could not infer STL/OBJ/3MF | Reject file and request supported format |

## Consumer Pattern

```ts
const resolved = await resolveMakerWorldModel(url);
if (!resolved.ok) {
  switch (resolved.reasonCode) {
    case "invalid_url":
      // user-input fix path
      break;
    case "upstream_blocked":
    case "timeout":
    case "network_error":
      // retry/backoff path
      break;
    default:
      // fallback UI/upload path
      break;
  }
}
```

## Observability

Persist or log these fields per failed attempt:

- `reasonCode`
- `message`
- `diagnostics.pipeline`
- `diagnostics.attempts`
- `diagnostics.warnings`
