import type { NormalizedRect } from "@shared/types";

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function parseRects(value: unknown): NormalizedRect[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    const x = asNumber(record?.["x"]);
    const y = asNumber(record?.["y"]);
    const w = asNumber(record?.["w"]);
    const h = asNumber(record?.["h"]);
    return x === undefined || y === undefined || w === undefined || h === undefined ? [] : [{ x, y, w, h }];
  });
}
