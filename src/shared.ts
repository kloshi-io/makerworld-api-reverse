export type MakerWorldReasonCode =
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

export type MakerWorldApiError = {
  reasonCode: MakerWorldReasonCode;
  message: string;
  status?: number;
};

export type MakerWorldApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MakerWorldApiError };

export function apiOk<T>(data: T): MakerWorldApiResult<T> {
  return { ok: true, data };
}

export function apiErr<T>(error: MakerWorldApiError): MakerWorldApiResult<T> {
  return { ok: false, error };
}
