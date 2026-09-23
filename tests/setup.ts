/**
 * Vitest global setup — runs once before all test files.
 *
 * Currently empty; per-test DB setup lives in tests/helpers/test-db.ts
 * because each test file gets its own PGlite instance to avoid races.
 */

// Ensure timezone is stable for snapshot tests
// guard:allow-env-mutation — test global setup pins TZ before tests load // guard:allow-env-credential — TZ is a locale setting, not a credential
process.env.TZ = "UTC";
