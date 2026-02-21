import { apiErr, apiOk, type MakerWorldApiResult } from "./shared.js";

const MAKERWORLD_DESIGN_SERVICE_BASE = "https://makerworld.com/v1/design-service";
const API_TIMEOUT_MS = 8_000;
const API_RETRY_COUNT = 1;

const API_HEADERS = {
  "user-agent": "3d-printing-service/1.0",
  accept: "application/json,text/plain,*/*",
  "x-bbl-client-type": "web",
  "x-bbl-client-version": "00.00.00.01",
  "x-bbl-app-source": "makerworld",
  "x-bbl-client-name": "MakerWorld",
};

export type MakerWorldApiRequestOptions = {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
};

type FetchApiJsonOptions = MakerWorldApiRequestOptions & {
  query?: Record<string, string | number | boolean | null | undefined>;
};

function buildApiUrl(pathname: string, query?: Record<string, string | number | boolean | null | undefined>) {
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const url = new URL(`${MAKERWORLD_DESIGN_SERVICE_BASE}/${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function mapHttpStatus(status: number) {
  if (status === 404) return { reasonCode: "not_found" as const, message: "MakerWorld resource was not found." };
  if (status === 401 || status === 403 || status === 429) {
    return {
      reasonCode: "upstream_blocked" as const,
      message: `MakerWorld blocked the request (${status}).`,
    };
  }
  if (status === 408 || status === 504) {
    return { reasonCode: "timeout" as const, message: "MakerWorld request timed out." };
  }
  return {
    reasonCode: "network_error" as const,
    message: `MakerWorld API request failed (${status}).`,
  };
}

async function fetchApiJson(
  pathname: string,
  options?: FetchApiJsonOptions,
): Promise<MakerWorldApiResult<unknown>> {
  const timeoutMs =
    typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : API_TIMEOUT_MS;
  const retries =
    typeof options?.retries === "number" && Number.isFinite(options.retries)
      ? Math.max(0, Math.trunc(options.retries))
      : API_RETRY_COUNT;
  const url = buildApiUrl(pathname, options?.query);
  const headers: Record<string, string> = { ...API_HEADERS, ...(options?.headers ?? {}) };

  let lastNetworkError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok) {
        const mapped = mapHttpStatus(response.status);
        return apiErr({ ...mapped, status: response.status });
      }

      const raw = await response.text();
      if (!raw.trim()) {
        return apiErr({
          reasonCode: "malformed_payload",
          message: "MakerWorld API returned an empty payload.",
          status: response.status,
        });
      }

      try {
        return apiOk(JSON.parse(raw));
      } catch {
        return apiErr({
          reasonCode: "malformed_payload",
          message: "MakerWorld API returned invalid JSON.",
          status: response.status,
        });
      }
    } catch (error) {
      lastNetworkError = error instanceof Error ? error : new Error("Unknown network error");
      const aborted = lastNetworkError.name === "AbortError";
      if (attempt >= retries) {
        return apiErr({
          reasonCode: aborted ? "timeout" : "network_error",
          message: aborted
            ? "MakerWorld API request timed out."
            : `MakerWorld API request failed: ${lastNetworkError.message}`,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return apiErr({
    reasonCode: "network_error",
    message: lastNetworkError?.message ?? "MakerWorld API request failed.",
  });
}

export function fetchDesignInstances(designId: number, options?: MakerWorldApiRequestOptions) {
  return fetchApiJson(`/design/${designId}/instances`, options);
}

export function fetchProfile(profileId: number, options?: MakerWorldApiRequestOptions) {
  return fetchApiJson(`/profile/${profileId}`, options);
}

export function fetchInstance3mf(instanceId: number, options?: MakerWorldApiRequestOptions) {
  return fetchApiJson(`/instance/${instanceId}/f3mf`, options);
}

export function fetchDesign(designId: number, options?: MakerWorldApiRequestOptions) {
  return fetchApiJson(`/design/${designId}`, options);
}

export function fetchDesignModel(designId: number, options?: MakerWorldApiRequestOptions) {
  return fetchApiJson(`/design/${designId}/model`, options);
}
