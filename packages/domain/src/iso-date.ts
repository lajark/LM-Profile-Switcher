import { z } from 'zod';

/**
 * A pure, platform-independent ISO 8601 date-time check.
 *
 * The PRD serializes timestamps as ISO 8601 strings (see
 * `schemas/profile.schema.json` `format: "date-time"`). This refine keeps the
 * check dependency-free (no `Date`/platform APIs) so it round-trips unchanged
 * through both JSON and YAML.
 */
const ISO_DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Zod schema for an ISO 8601 date-time string used by all domain contracts. */
export function isoDateTime(label: string) {
  return z
    .string()
    .refine((value) => ISO_DATE_TIME_RE.test(value), {
      message: `${label} must be an ISO 8601 date-time string`,
    });
}