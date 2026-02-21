# API Reference

## Exports

### `resolveMakerWorldModel(sourceUrl, options?)`

Resolve MakerWorld model metadata, profile estimates, selected variant details, and candidate download URL.

#### Signature

```ts
function resolveMakerWorldModel(
  sourceUrl: string,
  options?: MakerWorldResolveOptions,
): Promise<MakerWorldResolveOutcome>;
```

#### `MakerWorldResolveOptions`

```ts
type MakerWorldResolveOptions = {
  variantId?: number | null;
  request?: MakerWorldApiRequestOptions;
};
```

#### `MakerWorldApiRequestOptions`

```ts
type MakerWorldApiRequestOptions = {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
};
```

#### Success result

```ts
type MakerWorldResolveOutcome = {
  ok: true;
  state: "resolved";
  data: MakerWorldResolvedData;
  diagnostics: MakerWorldDiagnostics;
};
```

#### Failure result

```ts
type MakerWorldResolveOutcome = {
  ok: false;
  state: "unresolvable";
  reasonCode: MakerWorldReasonCode;
  message: string;
  diagnostics: MakerWorldDiagnostics;
};
```

#### Example

```ts
const resolved = await resolveMakerWorldModel(modelUrl, {
  variantId: 1452154,
  request: {
    timeoutMs: 10_000,
    retries: 2,
  },
});

if (!resolved.ok) {
  console.error(resolved.reasonCode, resolved.message);
}
```

---

### `downloadMakerWorldModelFile(downloadUrl, options?)`

Download model bytes and detect/validate extension.

#### Signature

```ts
function downloadMakerWorldModelFile(
  downloadUrl: string,
  options?: MakerWorldDownloadOptions,
): Promise<MakerWorldDownloadOutcome>;
```

#### `MakerWorldDownloadOptions`

```ts
type MakerWorldDownloadOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
};
```

#### Success result

```ts
type MakerWorldDownloadOutcome = {
  ok: true;
  state: "downloaded";
  buffer: Buffer;
  filename: string;
  extension: "stl" | "obj" | "3mf";
  contentType: string | null;
  finalUrl: string;
};
```

#### Failure result

```ts
type MakerWorldDownloadOutcome = {
  ok: false;
  state: "unavailable";
  reasonCode: MakerWorldReasonCode;
  message: string;
};
```

#### Example

```ts
const file = await downloadMakerWorldModelFile(downloadUrl, {
  timeoutMs: 15_000,
  maxBytes: 50 * 1024 * 1024,
});

if (file.ok) {
  await writeFile(file.filename, file.buffer);
}
```

---

## Key Types

### `MakerWorldReasonCode`

```ts
type MakerWorldReasonCode =
  | "invalid_url"
  | "not_found"
  | "upstream_blocked"
  | "timeout"
  | "malformed_payload"
  | "network_error"
  | "incompatible_profile"
  | "missing_profile_metrics"
  | "download_unavailable"
  | "unsupported_model_format";
```

### `MakerWorldDiagnostics`

```ts
type MakerWorldDiagnostics = {
  pipeline: Array<"api" | "next_data">;
  warnings: string[];
  attempts: Array<{
    source: "api" | "next_data";
    ok: boolean;
    reasonCode?: MakerWorldReasonCode;
    message: string;
  }>;
};
```

### `Material`

```ts
type Material = "PLA" | "PETG" | "other_request";
```

## Backward Compatibility

- Existing primary exports remain stable and additive.
- New request/download option fields are optional and non-breaking.
- All integration errors should be handled from typed outcomes instead of catch-based business logic.
