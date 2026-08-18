/**
 * Pagination query-parameter parsing.
 *
 * `Number("abc")` is NaN, and NaN survives both Math.max and Math.min unchanged.
 * It then reaches the D1 LIMIT/OFFSET bind and throws, so `?page=abc` answered
 * with HTTP 500 instead of falling back to the default. Every list endpoint
 * parsed its own parameters inline and shared the bug.
 */

interface BoundedIntOptions {
  /** Value to use when the parameter is absent or unparseable. */
  fallback: number;
  /** Lower clamp. Values below this are raised to it. */
  min?: number;
  /** Upper clamp. Values above this are lowered to it. */
  max?: number;
}

/**
 * Parse a query parameter into a bounded integer, falling back rather than
 * throwing on anything non-numeric.
 *
 * Absent, empty, NaN, and non-finite input all yield `fallback`. Numeric input
 * is floored, then clamped into [min, max].
 */
export function parseBoundedInt(
  raw: string | undefined,
  { fallback, min = 1, max }: BoundedIntOptions,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  let value = Math.floor(parsed);
  if (value < min) value = min;
  if (max !== undefined && value > max) value = max;
  return value;
}

/** Parse `?page=` — 1-based, defaults to 1. */
export function parsePage(raw: string | undefined): number {
  return parseBoundedInt(raw, { fallback: 1, min: 1 });
}

/** Parse `?per_page=` — defaults to 20, capped at 100 to bound query cost. */
export function parsePerPage(raw: string | undefined, fallback = 20, max = 100): number {
  return parseBoundedInt(raw, { fallback, min: 1, max });
}
