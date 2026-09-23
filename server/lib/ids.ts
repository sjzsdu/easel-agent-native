import { randomUUID } from "node:crypto";

/** Short unique id usable as a SQL primary key. */
export function newId(prefix = ""): string {
  const body = randomUUID().replace(/-/g, "").slice(0, 20);
  return prefix ? `${prefix}_${body}` : body;
}

/** Current timestamp as ISO-8601 UTC string (matches schema text columns). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Slugify a Chinese/ASCII name into a filesystem- and SQL-safe id. */
export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `p-${randomUUID().slice(0, 8)}`;
}
