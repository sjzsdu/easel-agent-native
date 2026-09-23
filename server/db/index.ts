import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

/**
 * Lazy singleton Drizzle client. Import `getDb` from this module in actions
 * (never from `@agent-native/core` directly — the local export carries the
 * app schema types).
 */
export const getDb = createGetDb(schema);
