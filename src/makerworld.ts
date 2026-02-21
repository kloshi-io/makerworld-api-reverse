import path from "node:path";

import { MAX_UPLOAD_BYTES, PRINTER_MODEL } from "./constants.js";
import {
  fetchDesign,
  fetchDesignInstances,
  fetchDesignModel,
  fetchInstance3mf,
  fetchProfile,
} from "./api.js";
import type {
  MakerWorldApiError,
  MakerWorldReasonCode,
} from "./shared.js";
import type { Material } from "./types.js";

const MAKERWORLD_PROVIDER = "makerworld";
const HTML_FETCH_TIMEOUT_MS = 12_000;
const MODEL_FETCH_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;

const ALLOWED_MODEL_EXTENSIONS = ["stl", "obj", "3mf"] as const;
const DOWNLOAD_HINT_PATTERN = /(download|asset|attachment|file=|\/files?\b|\.stl\b|\.obj\b|\.3mf\b)/i;

type ModelExtension = (typeof ALLOWED_MODEL_EXTENSIONS)[number];
type JsonLike = Record<string, unknown>;

type DataSource = "api" | "next_data";

type VariantCandidate = {
  variantId: number | null;
  profileId: number | null;
  name: string;
  printer: string;
  material: string;
  estimatedHours: number | null;
  estimatedGrams: number | null;
  payload: JsonLike;
  settingsSummary: MakerWorldSettingsSummary;
  downloadUrl: string | null;
};

type ResolvePipelineResult =
  | {
      ok: true;
      data: MakerWorldResolvedData;
      warnings: string[];
    }
  | {
      ok: false;
      reasonCode: MakerWorldReasonCode;
      message: string;
      warnings: string[];
    };

export type MakerWorldSettingsSummary = {
  layerHeightMm?: number;
  nozzleMm?: number;
  infillPercent?: number;
  supportEnabled?: boolean;
  wallLoops?: number;
  speedProfile?: string;
  filamentProfile?: string;
};

export type MakerWorldSelectionStrategy =
  | "requested_variant_id"
  | "user_selected_variant"
  | "shortest_time_fallback";

export type MakerWorldProfileResolutionMode = "strict" | "relaxed_printer";
export type MakerWorldProfileResolutionConfidence = "high" | "medium";

export type MakerWorldAvailableVariant = {
  variantId?: number;
  profileId?: number;
  name: string;
  printer: string;
  material: string;
  estimatedHours: number;
  estimatedGrams: number;
};

export type MakerWorldResolvedData = {
  sourceKind: "makerworld";
  sourceProvider: "makerworld";
  sourceUrl: string;
  sourceModelTitle: string;
  downloadUrl: string | null;
  fileOriginalName: string;
  selectedVariantId?: number;
  selectedProfileId?: number;
  selectionStrategy: MakerWorldSelectionStrategy;
  availableVariants: MakerWorldAvailableVariant[];
  importWarnings: string[];
  profileResolutionMode: MakerWorldProfileResolutionMode;
  profileResolutionConfidence: MakerWorldProfileResolutionConfidence;
  sourceProfileId: number | null;
  sourceProfileName: string;
  sourceProfilePrinter: string;
  sourceProfileMaterial: string;
  sourceProfileEstimatedGrams: number;
  sourceProfileEstimatedHours: number;
  sourceProfilePayload: JsonLike;
  sourceSettingsSummary: MakerWorldSettingsSummary;
  lockedMaterial: Material;
};

export type MakerWorldDiagnostics = {
  pipeline: DataSource[];
  warnings: string[];
  attempts: Array<{
    source: DataSource;
    ok: boolean;
    reasonCode?: MakerWorldReasonCode;
    message: string;
  }>;
};

export type MakerWorldResolveOutcome =
  | { ok: true; state: "resolved"; data: MakerWorldResolvedData; diagnostics: MakerWorldDiagnostics }
  | {
      ok: false;
      state: "unresolvable";
      reasonCode: MakerWorldReasonCode;
      message: string;
      diagnostics: MakerWorldDiagnostics;
    };

export type MakerWorldDownloadOutcome =
  | {
      ok: true;
      state: "downloaded";
      buffer: Buffer;
      filename: string;
      extension: ModelExtension;
      contentType: string | null;
      finalUrl: string;
    }
  | {
      ok: false;
      state: "unavailable";
      reasonCode: MakerWorldReasonCode;
      message: string;
    };

function isRecord(value: unknown): value is JsonLike {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizePrinterName(input: string) {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("p2s")) return "bambulabp2s";
  if (normalized.includes("p1s")) return "bambulabp1s";
  if (normalized.includes("p1p")) return "bambulabp1p";
  if (normalized.includes("x1c") || normalized.includes("x1carbon")) return "bambulabx1c";
  if (normalized.includes("a1mini")) return "bambulaba1mini";
  if (normalized.includes("a1")) return "bambulaba1";
  return normalized;
}

function getCompatibleNormalizedPrinters(configuredPrinter: string) {
  const normalized = normalizePrinterName(configuredPrinter);
  const aliases = new Set<string>([normalized]);
  const corexyCluster = new Set([
    "bambulabp2s",
    "bambulabp1s",
    "bambulabp1p",
    "bambulabx1c",
    "bambulabx1carbon",
  ]);
  if (corexyCluster.has(normalized)) {
    for (const item of corexyCluster) aliases.add(item);
  }
  return aliases;
}

function isCompatiblePrinterName(candidatePrinter: string, configuredPrinter: string) {
  const compatible = getCompatibleNormalizedPrinters(configuredPrinter);
  const normalizedCandidate = normalizePrinterName(candidatePrinter);
  if (!normalizedCandidate) return false;
  if (compatible.has(normalizedCandidate)) return true;
  for (const alias of compatible) {
    if (normalizedCandidate.includes(alias) || alias.includes(normalizedCandidate)) {
      return true;
    }
  }
  return false;
}

function mapMakerWorldMaterial(raw: string): Material {
  const normalized = raw.toLowerCase();
  if (normalized.includes("petg")) return "PETG";
  if (normalized.includes("pla")) return "PLA";
  return "other_request";
}

function parseFloatFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationHours(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    if (value <= 72) return value;
    if (value <= 7_200) return value / 60;
    return value / 3600;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hms = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (hms) {
    const hours = Number(hms[1]);
    const minutes = Number(hms[2]);
    const seconds = Number(hms[3] ?? 0);
    return hours + minutes / 60 + seconds / 3600;
  }

  const hourMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*h/i);
  const minuteMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*m/i);
  const secondMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (hourMatch || minuteMatch || secondMatch) {
    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    const seconds = secondMatch ? Number(secondMatch[1]) : 0;
    const total = hours + minutes / 60 + seconds / 3600;
    return total > 0 ? total : null;
  }

  const numeric = parseFloatFromUnknown(trimmed);
  if (numeric === null || numeric <= 0) return null;
  if (numeric <= 72) return numeric;
  if (numeric <= 7_200) return numeric / 60;
  return numeric / 3600;
}

function parseDurationHoursByKey(key: string, value: unknown): number | null {
  const normalized = key.toLowerCase();

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    if (normalized.includes("ms") || normalized.includes("millisecond")) return value / 3_600_000;
    if (
      normalized.includes("second") ||
      normalized.includes("sec") ||
      normalized.includes("prediction") ||
      normalized.includes("printtime") ||
      normalized.includes("print_time") ||
      normalized.includes("costtime") ||
      normalized.includes("consumetime") ||
      normalized.includes("duration")
    ) {
      return value / 3600;
    }
    if (normalized.includes("minute") || normalized.includes("min")) return value / 60;
    if (normalized.includes("hour") || normalized.includes("hr")) return value;
  }

  return parseDurationHours(value);
}

function normalizeModelExtension(extension: string | null): ModelExtension | null {
  if (!extension) return null;
  const normalized = extension.toLowerCase().replace(/^\./, "");
  if (normalized === "stl" || normalized === "obj" || normalized === "3mf") return normalized;
  return null;
}

function fileNameFromDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathName = parsed.pathname;
    const candidate = decodeURIComponent(path.basename(pathName));
    return candidate || "makerworld-model";
  } catch {
    return "makerworld-model";
  }
}

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const utf = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      return utf[1];
    }
  }

  const basic = value.match(/filename="?([^\";]+)"?/i);
  if (!basic?.[1]) return null;
  return basic[1].trim() || null;
}

function inferModelExtension(input: {
  explicitFilename: string;
  finalUrl: string;
  contentType: string | null;
}): ModelExtension | null {
  const explicitExt = normalizeModelExtension(path.extname(input.explicitFilename));
  if (explicitExt) return explicitExt;

  const urlExt = normalizeModelExtension(path.extname(fileNameFromDownloadUrl(input.finalUrl)));
  if (urlExt) return urlExt;

  const type = (input.contentType ?? "").toLowerCase();
  if (type.includes("3mf") || type.includes("zip")) return "3mf";
  if (type.includes("stl") || type.includes("sla")) return "stl";
  if (type.includes("obj")) return "obj";

  return null;
}

function visitNodes(
  input: unknown,
  visitor: (key: string, value: unknown, parent: unknown) => void,
  options?: { maxNodes?: number },
) {
  const maxNodes = options?.maxNodes ?? 1_500;
  const queue: Array<{ key: string; value: unknown; parent: unknown }> = [{
    key: "",
    value: input,
    parent: null,
  }];
  const visited = new Set<unknown>();
  let count = 0;

  while (queue.length && count < maxNodes) {
    const current = queue.shift();
    if (!current) break;
    count += 1;

    visitor(current.key, current.value, current.parent);

    if (!current.value || typeof current.value !== "object") continue;
    if (visited.has(current.value)) continue;
    visited.add(current.value);

    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        queue.push({ key: current.key, value: item, parent: current.value });
      }
      continue;
    }

    for (const [childKey, childValue] of Object.entries(current.value)) {
      queue.push({ key: childKey, value: childValue, parent: current.value });
    }
  }
}

function findStringByHints(input: unknown, hints: string[]): string | null {
  let found: string | null = null;
  visitNodes(input, (key, value) => {
    if (found) return;
    if (typeof value !== "string") return;
    const normalized = key.toLowerCase();
    if (!hints.some((hint) => normalized.includes(hint))) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    found = trimmed;
  });
  return found;
}

function findBooleanByHints(input: unknown, hints: string[]): boolean | undefined {
  let found: boolean | undefined;
  visitNodes(input, (key, value) => {
    if (found !== undefined) return;
    const normalized = key.toLowerCase();
    if (!hints.some((hint) => normalized.includes(hint))) return;
    if (typeof value === "boolean") {
      found = value;
      return;
    }
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (lowered === "true" || lowered === "yes" || lowered === "on") found = true;
      if (lowered === "false" || lowered === "no" || lowered === "off") found = false;
    }
  });
  return found;
}

function findNumberByHints(input: unknown, hints: string[]): number | null {
  let found: number | null = null;
  visitNodes(input, (key, value) => {
    if (found !== null) return;
    const normalized = key.toLowerCase();
    if (!hints.some((hint) => normalized.includes(hint))) return;
    const parsed = parseFloatFromUnknown(value);
    if (parsed === null || !Number.isFinite(parsed)) return;
    found = parsed;
  });
  return found;
}

function findDurationByHints(input: unknown, hints: string[]): number | null {
  const ignoreSubstrings = [
    "create",
    "update",
    "modify",
    "upload",
    "download",
    "publish",
    "release",
    "expire",
    "timestamp",
    "timezone",
    "date",
    "gmt",
    "utc",
  ];

  let found: number | null = null;
  visitNodes(input, (key, value) => {
    if (found !== null) return;
    const normalized = key.toLowerCase();
    if (!hints.some((hint) => normalized.includes(hint))) return;
    if (ignoreSubstrings.some((token) => normalized.includes(token))) return;
    const parsed = parseDurationHoursByKey(normalized, value);
    if (parsed === null || !Number.isFinite(parsed)) return;
    found = parsed;
  });
  return found;
}

function findIntegerByHints(input: unknown, hints: string[]): number | null {
  const value = findNumberByHints(input, hints);
  if (value === null) return null;
  const rounded = Math.trunc(value);
  return rounded > 0 ? rounded : null;
}

function findArrayByKeyHint(input: unknown, hints: string[]): unknown[] {
  let best: unknown[] = [];
  visitNodes(input, (key, value) => {
    if (!Array.isArray(value)) return;
    const normalized = key.toLowerCase();
    if (!hints.some((hint) => normalized.includes(hint))) return;
    const objectItems = value.filter((item) => !!item && typeof item === "object");
    if (objectItems.length > best.length) {
      best = objectItems;
    }
  });
  return best;
}

function asObjectArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => !!item && typeof item === "object");
}

function readByPath(input: unknown, path: string[]): unknown {
  let current: unknown = input;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return current;
}

function scoreVariantLikeItem(item: unknown): number {
  if (!isRecord(item)) return 0;

  let score = 0;
  if (findIntegerByHints(item, ["variantid", "instanceid", "profileid", "presetid", "id", "uid"]) !== null) {
    score += 4;
  }
  if (findStringByHints(item, ["printername", "printer", "machine", "device"])) score += 2;
  if (findStringByHints(item, ["material", "filament"])) score += 1;
  if (extractEstimatedHours(item) !== null) score += 2;
  if (extractEstimatedGrams(item) !== null) score += 2;
  if (chooseDownloadUrl(item) !== null) score += 1;

  return score;
}

function selectBestVariantArray(candidates: unknown[][]): unknown[] {
  let best: { items: unknown[]; score: number } | null = null;

  for (const items of candidates) {
    if (!items.length) continue;
    const score = items.reduce<number>((sum, item) => sum + scoreVariantLikeItem(item), 0);
    if (!best || score > best.score || (score === best.score && items.length > best.items.length)) {
      best = { items, score };
    }
  }

  return best?.items ?? [];
}

function collectUrlCandidates(input: unknown): string[] {
  const urls = new Set<string>();
  visitNodes(input, (_key, value) => {
    if (typeof value !== "string") return;
    const raw = value.trim();
    if (!raw) return;

    const decoded = raw.replace(/\\\//g, "/");
    const matches = decoded.match(/https?:\/\/[^\s\"'<>]+/gi) ?? [];
    for (const match of matches) {
      urls.add(match);
    }
    if (decoded.startsWith("/") && DOWNLOAD_HINT_PATTERN.test(decoded)) {
      urls.add(`https://makerworld.com${decoded}`);
    }
  });
  return [...urls];
}

function chooseDownloadUrl(input: unknown): string | null {
  for (const candidate of collectUrlCandidates(input)) {
    try {
      const parsed = new URL(candidate);
      const pathAndQuery = `${parsed.pathname}${parsed.search}`;
      if (!DOWNLOAD_HINT_PATTERN.test(pathAndQuery)) continue;
      return parsed.toString();
    } catch {
      // Ignore invalid URL candidates.
    }
  }
  return null;
}

function extractInstancesFromPayload(payload: unknown): unknown[] {
  const candidates: unknown[][] = [];
  const addCandidate = (value: unknown) => {
    const items = asObjectArray(value);
    if (items.length > 0) candidates.push(items);
  };

  addCandidate(payload);

  const preferredPaths = [
    ["props", "pageProps", "design", "instances"],
    ["props", "pageProps", "design", "profiles"],
    ["props", "pageProps", "design", "variants"],
    ["props", "pageProps", "instances"],
    ["props", "pageProps", "profiles"],
    ["props", "pageProps", "variants"],
    ["pageProps", "design", "instances"],
    ["pageProps", "design", "profiles"],
    ["pageProps", "design", "variants"],
    ["design", "instances"],
    ["design", "profiles"],
    ["design", "variants"],
    ["data", "design", "instances"],
    ["result", "design", "instances"],
  ];
  for (const path of preferredPaths) {
    addCandidate(readByPath(payload, path));
  }

  if (isRecord(payload)) {
    const directPaths: unknown[] = [
      payload.props,
      payload.result,
      payload.design,
      payload.model,
      payload.pageProps,
    ];

    addCandidate(payload.instances);
    addCandidate(payload.profiles);
    addCandidate(payload.variants);

    for (const value of directPaths) {
      if (!isRecord(value)) continue;
      addCandidate(value.instances);
      addCandidate(value.profiles);
      addCandidate(value.variants);
      addCandidate(value.list);
      addCandidate(value.items);
      addCandidate(value.hits);
    }
  }

  visitNodes(payload, (key, value, parent) => {
    if (!Array.isArray(value)) return;
    const normalized = key.toLowerCase();
    const isLikelyVariantKey =
      normalized.includes("instance") ||
      normalized.includes("profile") ||
      normalized.includes("variant") ||
      normalized.includes("preset");
    const parentKeys = isRecord(parent) ? Object.keys(parent).join("|").toLowerCase() : "";
    const parentSuggestsModel =
      parentKeys.includes("design") ||
      parentKeys.includes("model") ||
      parentKeys.includes("profile") ||
      parentKeys.includes("instance") ||
      parentKeys.includes("variant");

    if (!isLikelyVariantKey && !(parentSuggestsModel && (normalized === "list" || normalized === "items"))) return;
    addCandidate(value);
  });

  const best = selectBestVariantArray(candidates);
  if (best.length > 0) return best;

  return findArrayByKeyHint(payload, ["instances", "profiles", "variants", "presets"]);
}

function extractModelTitle(payload: unknown): string {
  const title =
    findStringByHints(payload, ["title", "designtitle", "modeltitle"]) ??
    findStringByHints(payload, ["name", "displayname"]);
  return title && title.length > 0 ? title : "MakerWorld model";
}

function extractEstimatedHours(instance: unknown): number | null {
  const fromPlates = findArrayByKeyHint(instance, ["plates"])
    .map((entry) =>
      findDurationByHints(entry, [
        "prediction",
        "estimate",
        "estimated",
        "printtime",
        "print_time",
        "duration",
        "costtime",
        "consumetime",
      ]),
    )
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .reduce((sum, value) => sum + value, 0);

  if (fromPlates > 0) return Number(fromPlates.toFixed(4));

  const direct = findDurationByHints(instance, [
    "prediction",
    "estimate",
    "estimated",
    "estimatedhours",
    "printtimehours",
    "print_time_hours",
    "print_time",
    "printtime",
    "duration",
    "costtime",
    "consumetime",
    "elapsed",
  ]);
  if (direct !== null && direct > 0) return Number(direct.toFixed(4));
  return null;
}

function extractEstimatedGrams(instance: unknown): number | null {
  const fromPlates = findArrayByKeyHint(instance, ["plates"])
    .map((entry) => findNumberByHints(entry, ["weight", "grams", "filament"]))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .reduce((sum, value) => sum + value, 0);
  if (fromPlates > 0) return Number(fromPlates.toFixed(4));

  const direct = findNumberByHints(instance, [
    "estimatedweight",
    "filamentweight",
    "materialweight",
    "grams",
    "weight",
    "filament",
  ]);
  if (direct !== null && direct > 0) return Number(direct.toFixed(4));
  return null;
}

function extractPrinter(instance: unknown): string {
  const compatibilityValues: string[] = [];
  const addCompatibilityEntry = (entry: unknown) => {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed) compatibilityValues.push(trimmed);
      return;
    }
    if (!isRecord(entry)) return;
    const byKnownKeys = [
      entry.devProductName,
      entry.productName,
      entry.printerName,
      entry.machineName,
      entry.modelName,
      entry.name,
      entry.devModelName,
    ];
    for (const value of byKnownKeys) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed) compatibilityValues.push(trimmed);
    }
  };

  const compatibilityEntries = findArrayByKeyHint(instance, ["compatibility", "othercompatibility"]);
  for (const entry of compatibilityEntries) addCompatibilityEntry(entry);

  visitNodes(instance, (key, value) => {
    if (!isRecord(value)) return;
    const normalized = key.toLowerCase();
    if (!(normalized.includes("compatibility") || normalized.includes("othercompatibility"))) return;
    addCompatibilityEntry(value);
  });

  if (compatibilityValues.length > 0) {
    const configured = normalizePrinterName(PRINTER_MODEL);
    const exact = compatibilityValues.find((value) => normalizePrinterName(value) === configured);
    if (exact) return exact;

    const preferred = compatibilityValues.find((value) => isCompatiblePrinterName(value, PRINTER_MODEL));
    return preferred ?? compatibilityValues[0]!;
  }

  const direct = findStringByHints(instance, [
    "printername",
    "printer_model",
    "printer",
    "machine",
    "device",
    "productname",
    "modelname",
    "devproductname",
    "devmodelname",
  ]);
  return direct ?? "unknown";
}

function extractMaterial(instance: unknown): string {
  const direct = findStringByHints(instance, ["material", "filament", "filamentname", "materialname"]);
  if (direct) return direct;
  return "unknown";
}

function extractSettingsSummary(instance: unknown): MakerWorldSettingsSummary {
  const layerHeight = findNumberByHints(instance, ["layerheight", "layer_height"]);
  const nozzle = findNumberByHints(instance, ["nozzle", "nozzlediameter"]);
  const infill = findNumberByHints(instance, ["infill", "filldensity"]);
  const wallLoops = findNumberByHints(instance, ["wallloop", "wall_loops", "walls"]);
  const support = findBooleanByHints(instance, ["support"]);

  const speedProfile = findStringByHints(instance, ["speedprofile", "speed_profile"]);
  const filamentProfile = findStringByHints(instance, ["filamentprofile", "filament_profile"]);

  return {
    ...(layerHeight && layerHeight > 0 ? { layerHeightMm: Number(layerHeight.toFixed(4)) } : {}),
    ...(nozzle && nozzle > 0 ? { nozzleMm: Number(nozzle.toFixed(4)) } : {}),
    ...(infill && infill > 0 ? { infillPercent: Number(infill.toFixed(2)) } : {}),
    ...(support !== undefined ? { supportEnabled: support } : {}),
    ...(wallLoops && wallLoops > 0 ? { wallLoops: Number(wallLoops.toFixed(2)) } : {}),
    ...(speedProfile ? { speedProfile } : {}),
    ...(filamentProfile ? { filamentProfile } : {}),
  };
}

function toVariantCandidate(raw: unknown): VariantCandidate | null {
  if (!isRecord(raw)) return null;

  const variantId = findIntegerByHints(raw, ["variantid", "instanceid", "id"]);
  const profileId = findIntegerByHints(raw, ["profileid", "presetid", "profile_id", "preset_id"]);

  if (variantId === null && profileId === null) return null;

  const name =
    findStringByHints(raw, ["title", "name", "profilename", "instancename"]) ??
    `MakerWorld variant ${variantId ?? profileId}`;

  return {
    variantId,
    profileId,
    name,
    printer: extractPrinter(raw),
    material: extractMaterial(raw),
    estimatedHours: extractEstimatedHours(raw),
    estimatedGrams: extractEstimatedGrams(raw),
    payload: raw,
    settingsSummary: extractSettingsSummary(raw),
    downloadUrl: chooseDownloadUrl(raw),
  };
}

function hasCompleteMetrics(variant: VariantCandidate) {
  return (
    typeof variant.estimatedHours === "number" &&
    Number.isFinite(variant.estimatedHours) &&
    variant.estimatedHours > 0 &&
    typeof variant.estimatedGrams === "number" &&
    Number.isFinite(variant.estimatedGrams) &&
    variant.estimatedGrams > 0
  );
}

function dedupeVariants(variants: VariantCandidate[]) {
  const map = new Map<string, VariantCandidate>();
  for (const variant of variants) {
    const idKey = variant.variantId ?? variant.profileId;
    const key = `${idKey ?? "none"}:${variant.name.toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, variant);
      continue;
    }

    const existing = map.get(key);
    if (!existing) continue;
    const existingScore = Number(hasCompleteMetrics(existing)) + Number(existing.downloadUrl !== null);
    const incomingScore = Number(hasCompleteMetrics(variant)) + Number(variant.downloadUrl !== null);
    if (incomingScore > existingScore) {
      map.set(key, variant);
    }
  }
  return [...map.values()];
}

function scoreAndSortVariants(variants: VariantCandidate[]) {
  return [...variants].sort((a, b) => {
    const aHours = a.estimatedHours ?? Number.POSITIVE_INFINITY;
    const bHours = b.estimatedHours ?? Number.POSITIVE_INFINITY;
    if (aHours !== bHours) return aHours - bHours;
    const aGrams = a.estimatedGrams ?? Number.POSITIVE_INFINITY;
    const bGrams = b.estimatedGrams ?? Number.POSITIVE_INFINITY;
    return aGrams - bGrams;
  });
}

function findVariantByRequestedId(variants: VariantCandidate[], requestedId: number) {
  return variants.find((variant) => variant.variantId === requestedId || variant.profileId === requestedId) ?? null;
}

function finalizeResolvedData(input: {
  sourceUrl: string;
  sourceModelTitle: string;
  requestedVariantId: number | null;
  userVariantId: number | null;
  variants: VariantCandidate[];
  warnings: string[];
}): ResolvePipelineResult {
  const warnings = [...input.warnings];

  const strict = input.variants.filter((variant) => isCompatiblePrinterName(variant.printer, PRINTER_MODEL));
  const strictWithMetrics = strict.filter(hasCompleteMetrics);
  const variantsWithMetrics = input.variants.filter(hasCompleteMetrics);

  const explicitRequestedId = input.requestedVariantId ?? input.userVariantId;
  const explicitRequestedWithMetrics =
    explicitRequestedId !== null ? findVariantByRequestedId(variantsWithMetrics, explicitRequestedId) : null;

  let candidatePool = strictWithMetrics;
  let resolutionMode: MakerWorldProfileResolutionMode = "strict";
  let resolutionConfidence: MakerWorldProfileResolutionConfidence = "high";

  if (!candidatePool.length) {
    if (explicitRequestedWithMetrics) {
      candidatePool = [explicitRequestedWithMetrics];
      warnings.push("Printer compatibility inferred from explicitly selected MakerWorld variant.");
    } else {
      candidatePool = variantsWithMetrics;
    }
    if (!candidatePool.length) {
      return {
        ok: false,
        reasonCode: "missing_profile_metrics",
        message: "MakerWorld profile data is incomplete for this model.",
        warnings,
      };
    }
    if (!explicitRequestedWithMetrics) {
      resolutionMode = "relaxed_printer";
      resolutionConfidence = "medium";
      warnings.push("Printer compatibility could not be verified strictly. Using the best available MakerWorld variant.");
    }
  }

  const sortedPool = scoreAndSortVariants(candidatePool);
  let selected = sortedPool[0] ?? null;
  let selectionStrategy: MakerWorldSelectionStrategy = "shortest_time_fallback";

  if (input.requestedVariantId !== null) {
    const requested = findVariantByRequestedId(sortedPool, input.requestedVariantId);
    if (requested) {
      selected = requested;
      selectionStrategy = "requested_variant_id";
    } else {
      warnings.push("Requested MakerWorld variant was unavailable. Used the best available variant.");
    }
  } else if (input.userVariantId !== null) {
    const userSelected = findVariantByRequestedId(sortedPool, input.userVariantId);
    if (userSelected) {
      selected = userSelected;
      selectionStrategy = "user_selected_variant";
    } else {
      warnings.push("Selected MakerWorld variant was unavailable. Used the best available variant.");
    }
  }

  if (!selected || !hasCompleteMetrics(selected)) {
    return {
      ok: false,
      reasonCode: "missing_profile_metrics",
      message: "MakerWorld profile metrics are unavailable for the selected model.",
      warnings,
    };
  }

  const availableVariants: MakerWorldAvailableVariant[] = sortedPool
    .filter(hasCompleteMetrics)
    .map((variant) => ({
      variantId: variant.variantId ?? undefined,
      profileId: variant.profileId ?? undefined,
      name: variant.name,
      printer: variant.printer,
      material: variant.material,
      estimatedHours: Number((variant.estimatedHours ?? 0).toFixed(4)),
      estimatedGrams: Number((variant.estimatedGrams ?? 0).toFixed(4)),
    }));

  const materialLabel = selected.material || "unknown";
  const selectedVariantId = selected.variantId ?? selected.profileId ?? undefined;
  const selectedProfileId = selected.profileId ?? selected.variantId ?? undefined;
  const resolvedDownloadUrl = selected.downloadUrl;

  const data: MakerWorldResolvedData = {
    sourceKind: "makerworld",
    sourceProvider: MAKERWORLD_PROVIDER,
    sourceUrl: input.sourceUrl,
    sourceModelTitle: input.sourceModelTitle,
    downloadUrl: resolvedDownloadUrl,
    fileOriginalName: resolvedDownloadUrl ? fileNameFromDownloadUrl(resolvedDownloadUrl) : "makerworld-model",
    selectedVariantId,
    selectedProfileId,
    selectionStrategy,
    availableVariants,
    importWarnings: [...new Set(warnings)],
    profileResolutionMode: resolutionMode,
    profileResolutionConfidence: resolutionConfidence,
    sourceProfileId: selected.profileId ?? selected.variantId ?? null,
    sourceProfileName: selected.name,
    sourceProfilePrinter: selected.printer,
    sourceProfileMaterial: materialLabel,
    sourceProfileEstimatedGrams: Number((selected.estimatedGrams ?? 0).toFixed(4)),
    sourceProfileEstimatedHours: Number((selected.estimatedHours ?? 0).toFixed(4)),
    sourceProfilePayload: {
      source_variant_id: selected.variantId,
      source_profile_id: selected.profileId,
      selection_strategy: selectionStrategy,
      profile_resolution_mode: resolutionMode,
      profile_resolution_confidence: resolutionConfidence,
      import_warnings: [...new Set(warnings)],
      raw_variant_payload: selected.payload,
    },
    sourceSettingsSummary: selected.settingsSummary,
    lockedMaterial: mapMakerWorldMaterial(materialLabel),
  };

  return { ok: true, data, warnings };
}

function extractNextDataPayload(html: string): unknown | null {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  return parseJsonSafely(match[1]);
}

async function fetchTextWithLimit(url: string, timeoutMs: number, maxBytes: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": "3d-printing-service/1.0", accept: "text/html,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`MakerWorld page request failed (${response.status})`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 0 && contentLength > maxBytes) {
      throw new Error("MakerWorld page is too large to parse.");
    }

    const raw = await response.text();
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes > maxBytes) {
      throw new Error("MakerWorld page is too large to parse.");
    }

    return raw;
  } finally {
    clearTimeout(timeout);
  }
}

function toResolveFailure(reasonCode: MakerWorldReasonCode, message: string, diagnostics: MakerWorldDiagnostics) {
  return {
    ok: false as const,
    state: "unresolvable" as const,
    reasonCode,
    message,
    diagnostics,
  };
}

function normalizeSourceUrl(input: string): {
  ok: true;
  normalized: string;
  designId: number;
  requestedVariantId: number | null;
} | {
  ok: false;
  reasonCode: MakerWorldReasonCode;
  message: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return {
      ok: false,
      reasonCode: "invalid_url",
      message: "MakerWorld model page URL is required.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || !(host === "makerworld.com" || host.endsWith(".makerworld.com"))) {
    return {
      ok: false,
      reasonCode: "invalid_url",
      message: "MakerWorld model page URL is required.",
    };
  }

  if (!/\/models?\//i.test(parsed.pathname)) {
    return {
      ok: false,
      reasonCode: "invalid_url",
      message: "MakerWorld model page URL is required.",
    };
  }

  const designMatch = parsed.pathname.match(/\/models?\/(\d+)/i);
  const designId = designMatch?.[1] ? Number(designMatch[1]) : Number.NaN;
  if (!Number.isFinite(designId) || designId <= 0) {
    return {
      ok: false,
      reasonCode: "invalid_url",
      message: "Could not extract MakerWorld design ID from URL.",
    };
  }

  const hashMatch = parsed.hash.match(/profileid-(\d+)/i);
  const requestedVariantId = hashMatch?.[1] ? Number(hashMatch[1]) : null;

  const normalized = new URL(parsed.toString());
  normalized.hash = "";

  return {
    ok: true,
    normalized: normalized.toString(),
    designId,
    requestedVariantId:
      requestedVariantId !== null && Number.isFinite(requestedVariantId) && requestedVariantId > 0
        ? requestedVariantId
        : null,
  };
}

async function maybeEnrichWithProfile(candidate: VariantCandidate): Promise<VariantCandidate> {
  if (candidate.profileId === null) return candidate;
  if (hasCompleteMetrics(candidate) && candidate.printer !== "unknown" && candidate.material !== "unknown") {
    return candidate;
  }

  const profileResult = await fetchProfile(candidate.profileId);
  if (!profileResult.ok || !isRecord(profileResult.data)) return candidate;

  const merged: VariantCandidate = {
    ...candidate,
    printer: candidate.printer !== "unknown" ? candidate.printer : extractPrinter(profileResult.data),
    material: candidate.material !== "unknown" ? candidate.material : extractMaterial(profileResult.data),
    estimatedHours: candidate.estimatedHours ?? extractEstimatedHours(profileResult.data),
    estimatedGrams: candidate.estimatedGrams ?? extractEstimatedGrams(profileResult.data),
    settingsSummary:
      Object.keys(candidate.settingsSummary).length > 0
        ? candidate.settingsSummary
        : extractSettingsSummary(profileResult.data),
    downloadUrl: candidate.downloadUrl ?? chooseDownloadUrl(profileResult.data),
    payload: {
      ...candidate.payload,
      profile_payload: profileResult.data,
    },
  };

  return merged;
}

async function resolveViaApi(input: {
  sourceUrl: string;
  designId: number;
  requestedVariantId: number | null;
  userVariantId: number | null;
}): Promise<ResolvePipelineResult> {
  const warnings: string[] = [];

  const [designResult, instancesResult] = await Promise.all([
    fetchDesign(input.designId),
    fetchDesignInstances(input.designId),
  ]);

  if (!instancesResult.ok) {
    return {
      ok: false,
      reasonCode: instancesResult.error.reasonCode,
      message: instancesResult.error.message,
      warnings,
    };
  }

  const rawInstances = extractInstancesFromPayload(instancesResult.data);
  const fallbackInstances = designResult.ok ? extractInstancesFromPayload(designResult.data) : [];
  const instanceSource = rawInstances.length > 0 ? rawInstances : fallbackInstances;

  if (!instanceSource.length) {
    return {
      ok: false,
      reasonCode: "malformed_payload",
      message: "MakerWorld API did not return usable variant data.",
      warnings,
    };
  }

  const mapped = dedupeVariants(instanceSource.map(toVariantCandidate).filter((item): item is VariantCandidate => !!item));
  if (!mapped.length) {
    return {
      ok: false,
      reasonCode: "malformed_payload",
      message: "MakerWorld API returned variants in an unsupported format.",
      warnings,
    };
  }

  const enriched = await Promise.all(mapped.map((variant) => maybeEnrichWithProfile(variant)));

  const titlePayload = designResult.ok ? designResult.data : instancesResult.data;
  const finalized = finalizeResolvedData({
    sourceUrl: input.sourceUrl,
    sourceModelTitle: extractModelTitle(titlePayload),
    requestedVariantId: input.requestedVariantId,
    userVariantId: input.userVariantId,
    variants: enriched,
    warnings,
  });

  if (!finalized.ok) return finalized;

  let downloadUrl = finalized.data.downloadUrl;

  if (finalized.data.selectedVariantId) {
    const instanceDownload = await fetchInstance3mf(finalized.data.selectedVariantId);
    if (instanceDownload.ok) {
      downloadUrl = chooseDownloadUrl(instanceDownload.data) ?? downloadUrl;
    }
  }

  const modelDownload = await fetchDesignModel(input.designId);
  if (modelDownload.ok) {
    downloadUrl = downloadUrl ?? chooseDownloadUrl(modelDownload.data);
  }

  const output: MakerWorldResolvedData = {
    ...finalized.data,
    downloadUrl,
    fileOriginalName: downloadUrl ? fileNameFromDownloadUrl(downloadUrl) : "makerworld-model",
  };

  return {
    ok: true,
    data: output,
    warnings: finalized.warnings,
  };
}

async function resolveViaNextData(input: {
  sourceUrl: string;
  requestedVariantId: number | null;
  userVariantId: number | null;
}): Promise<ResolvePipelineResult> {
  const warnings: string[] = [];

  let html: string;
  try {
    html = await fetchTextWithLimit(input.sourceUrl, HTML_FETCH_TIMEOUT_MS, MAX_HTML_BYTES);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch MakerWorld page.";
    if (/timed out|abort/i.test(message)) {
      return { ok: false, reasonCode: "timeout", message: "MakerWorld page request timed out.", warnings };
    }
    return { ok: false, reasonCode: "network_error", message, warnings };
  }

  const nextData = extractNextDataPayload(html);
  if (!nextData) {
    return {
      ok: false,
      reasonCode: "malformed_payload",
      message: "MakerWorld page did not expose __NEXT_DATA__ payload.",
      warnings,
    };
  }

  const instances = extractInstancesFromPayload(nextData);
  if (!instances.length) {
    return {
      ok: false,
      reasonCode: "malformed_payload",
      message: "MakerWorld fallback payload did not include variants.",
      warnings,
    };
  }

  const variants = dedupeVariants(instances.map(toVariantCandidate).filter((item): item is VariantCandidate => !!item));
  if (!variants.length) {
    return {
      ok: false,
      reasonCode: "malformed_payload",
      message: "MakerWorld fallback payload variant format was unsupported.",
      warnings,
    };
  }

  const enriched = await Promise.all(variants.map((variant) => maybeEnrichWithProfile(variant)));

  const finalized = finalizeResolvedData({
    sourceUrl: input.sourceUrl,
    sourceModelTitle: extractModelTitle(nextData),
    requestedVariantId: input.requestedVariantId,
    userVariantId: input.userVariantId,
    variants: enriched,
    warnings,
  });

  if (!finalized.ok) return finalized;

  return {
    ok: true,
    data: finalized.data,
    warnings: finalized.warnings,
  };
}

function createAttempt(source: DataSource, result: MakerWorldApiError | null, message: string) {
  if (!result) {
    return { source, ok: true as const, message };
  }
  return {
    source,
    ok: false as const,
    reasonCode: result.reasonCode,
    message: result.message || message,
  };
}

export async function resolveMakerWorldModel(
  sourceUrl: string,
  options?: { variantId?: number | null },
): Promise<MakerWorldResolveOutcome> {
  const diagnostics: MakerWorldDiagnostics = {
    pipeline: [],
    warnings: [],
    attempts: [],
  };
  try {
    const normalized = normalizeSourceUrl(sourceUrl);
    if (!normalized.ok) {
      diagnostics.attempts.push({
        source: "api",
        ok: false,
        reasonCode: normalized.reasonCode,
        message: normalized.message,
      });
      return toResolveFailure(normalized.reasonCode, normalized.message, diagnostics);
    }

    const userVariantId =
      typeof options?.variantId === "number" && Number.isFinite(options.variantId) && options.variantId > 0
        ? Math.trunc(options.variantId)
        : null;

    const apiResolved = await resolveViaApi({
      sourceUrl: normalized.normalized,
      designId: normalized.designId,
      requestedVariantId: normalized.requestedVariantId,
      userVariantId,
    });

    diagnostics.pipeline.push("api");

    if (apiResolved.ok) {
      diagnostics.attempts.push(createAttempt("api", null, "Resolved via MakerWorld API."));
      diagnostics.warnings = [...new Set(apiResolved.warnings)];
      return {
        ok: true,
        state: "resolved",
        data: {
          ...apiResolved.data,
          importWarnings: [...new Set(apiResolved.warnings)],
        },
        diagnostics,
      };
    }

    diagnostics.attempts.push({
      source: "api",
      ok: false,
      reasonCode: apiResolved.reasonCode,
      message: apiResolved.message,
    });

    const fallbackResolved = await resolveViaNextData({
      sourceUrl: normalized.normalized,
      requestedVariantId: normalized.requestedVariantId,
      userVariantId,
    });

    diagnostics.pipeline.push("next_data");

    if (fallbackResolved.ok) {
      diagnostics.attempts.push(createAttempt("next_data", null, "Resolved via __NEXT_DATA__ fallback."));
      diagnostics.warnings = [...new Set(fallbackResolved.warnings)];
      return {
        ok: true,
        state: "resolved",
        data: {
          ...fallbackResolved.data,
          importWarnings: [...new Set(fallbackResolved.warnings)],
        },
        diagnostics,
      };
    }

    diagnostics.attempts.push({
      source: "next_data",
      ok: false,
      reasonCode: fallbackResolved.reasonCode,
      message: fallbackResolved.message,
    });

    diagnostics.warnings = [...new Set([...apiResolved.warnings, ...fallbackResolved.warnings])];

    return toResolveFailure(fallbackResolved.reasonCode, fallbackResolved.message, diagnostics);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MakerWorld resolver failed unexpectedly.";
    diagnostics.warnings = [
      ...new Set([...diagnostics.warnings, "Resolver recovered from an unexpected internal error."]),
    ];
    diagnostics.attempts.push({
      source: diagnostics.pipeline[diagnostics.pipeline.length - 1] ?? "api",
      ok: false,
      reasonCode: "network_error",
      message,
    });
    return toResolveFailure("network_error", "Could not import MakerWorld profile. Please upload STL/OBJ/3MF.", diagnostics);
  }
}

type FetchModelFileResult =
  | {
      ok: true;
      buffer: Buffer;
      finalUrl: string;
      contentType: string | null;
      contentDisposition: string | null;
    }
  | {
      ok: false;
      status?: number;
      reasonCode: MakerWorldReasonCode;
      message: string;
    };

async function fetchModelFileWithLimit(url: string, maxBytes: number): Promise<FetchModelFileResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": "3d-printing-service/1.0", accept: "*/*" },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
        reasonCode: response.status === 404 ? ("not_found" as const) : ("download_unavailable" as const),
        message: `MakerWorld model download failed (${response.status}).`,
      };
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 0 && contentLength > maxBytes) {
      return {
        ok: false as const,
        status: response.status,
        reasonCode: "download_unavailable" as const,
        message: "MakerWorld model is too large (max 50MB on current plan).",
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      return {
        ok: false as const,
        status: response.status,
        reasonCode: "download_unavailable" as const,
        message: "MakerWorld model is too large (max 50MB on current plan).",
      };
    }

    return {
      ok: true as const,
      buffer: bytes,
      finalUrl: response.url || url,
      contentType: response.headers.get("content-type"),
      contentDisposition: response.headers.get("content-disposition"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download request failed.";
    if (/abort|timed out/i.test(message)) {
      return {
        ok: false as const,
        reasonCode: "timeout" as const,
        message: "MakerWorld model download timed out.",
      };
    }
    return {
      ok: false as const,
      reasonCode: "download_unavailable" as const,
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadMakerWorldModelFile(downloadUrl: string): Promise<MakerWorldDownloadOutcome> {
  try {
    const fetched = await fetchModelFileWithLimit(downloadUrl, MAX_UPLOAD_BYTES);
    if (!fetched.ok) {
      return {
        ok: false,
        state: "unavailable",
        reasonCode: fetched.reasonCode,
        message: fetched.message,
      };
    }

    const headerFilename = parseContentDispositionFilename(fetched.contentDisposition);
    const fallbackFilename = fileNameFromDownloadUrl(fetched.finalUrl);
    const baseFilename = (headerFilename ?? fallbackFilename ?? "makerworld-model").trim() || "makerworld-model";

    const extension = inferModelExtension({
      explicitFilename: baseFilename,
      finalUrl: fetched.finalUrl,
      contentType: fetched.contentType,
    });

    if (!extension) {
      return {
        ok: false,
        state: "unavailable",
        reasonCode: "unsupported_model_format",
        message: "Could not detect STL/OBJ/3MF format from MakerWorld download.",
      };
    }

    let filename = baseFilename;
    if (!filename.toLowerCase().endsWith(`.${extension}`)) {
      filename = `${filename}.${extension}`;
    }

    return {
      ok: true,
      state: "downloaded",
      buffer: fetched.buffer,
      filename,
      extension,
      contentType: fetched.contentType,
      finalUrl: fetched.finalUrl,
    };
  } catch (error) {
    return {
      ok: false,
      state: "unavailable",
      reasonCode: "download_unavailable",
      message: error instanceof Error ? error.message : "MakerWorld model download failed.",
    };
  }
}
