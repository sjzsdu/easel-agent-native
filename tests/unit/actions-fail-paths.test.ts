/**
 * Action fail-path tests — verify that deterministic failures (missing records,
 * invalid inputs that pass schema but fail business logic) raise the right
 * contract errors with correct status codes.
 *
 * Schema-level validation (zod) runs at the framework dispatch layer; here we
 * focus on the business-logic fail() calls inside each action's run function.
 *
 * Uses vi.hoisted + vi.mock so the mock module captures `getDb` from the
 * hoisted variable, which we populate in beforeAll with the test DB instance.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isActionContractError } from "@agent-native/core/action";

import { createTestDb } from "../helpers/test-db.js";

// Hoist a mutable container that the mock factory can close over.
// vi.mock is hoisted to the top, so it needs a variable declared via vi.hoisted.
const hoisted = vi.hoisted(() => ({
  testDb: null as Awaited<ReturnType<typeof createTestDb>> | null,
}));

vi.mock("../../server/db/index.js", () => ({
  getDb: () => {
    if (!hoisted.testDb) throw new Error("testDb not initialized");
    return hoisted.testDb.db;
  },
}));

describe("action fail paths — profile", () => {
  let profileAction: typeof import("../../actions/profile.js").default;
  let profileDeleteAction: typeof import("../../actions/profile-delete.js").default;

  beforeAll(async () => {
    hoisted.testDb = await createTestDb();
    profileAction = (await import("../../actions/profile.js")).default;
    profileDeleteAction = (await import("../../actions/profile-delete.js")).default;
  });

  afterAll(async () => {
    if (hoisted.testDb) await hoisted.testDb.close();
    hoisted.testDb = null;
  });

  it("profile: reading non-existent id fails with 404", async () => {
    try {
      await profileAction.run({ id: "nonexistent-id-xyz" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isActionContractError(err)).toBe(true);
      expect(err).toHaveProperty("statusCode", 404);
      expect(String((err as Error).message)).toContain("画像不存在");
    }
  });

  it("profile-delete: deleting non-existent id fails with 404", async () => {
    try {
      await profileDeleteAction.run({ id: "nonexistent-id-xyz" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isActionContractError(err)).toBe(true);
      expect(err).toHaveProperty("statusCode", 404);
      expect(String((err as Error).message)).toContain("画像不存在");
    }
  });

  it("profile: returns null profile hint when no profiles exist", async () => {
    const result = await profileAction.run({});
    expect(result.profile).toBeNull();
    expect(result.hint).toBeDefined();
  });
});

describe("action fail paths — ideas", () => {
  let ideaDeleteAction: typeof import("../../actions/idea-delete.js").default;
  let ideaSaveAction: typeof import("../../actions/idea-save.js").default;

  beforeAll(async () => {
    hoisted.testDb = await createTestDb();
    ideaDeleteAction = (await import("../../actions/idea-delete.js")).default;
    ideaSaveAction = (await import("../../actions/idea-save.js")).default;
  });

  afterAll(async () => {
    if (hoisted.testDb) await hoisted.testDb.close();
    hoisted.testDb = null;
  });

  it("idea-delete: deleting non-existent id fails with 404", async () => {
    try {
      await ideaDeleteAction.run({ id: "nonexistent-idea-xyz" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isActionContractError(err)).toBe(true);
      expect(err).toHaveProperty("statusCode", 404);
      expect(String((err as Error).message)).toContain("选题不存在");
    }
  });

  it("idea-save: updating non-existent id fails with 404", async () => {
    try {
      await ideaSaveAction.run({
        id: "nonexistent-idea-xyz",
        title: "Test Idea",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isActionContractError(err)).toBe(true);
      expect(err).toHaveProperty("statusCode", 404);
      expect(String((err as Error).message)).toContain("选题不存在");
    }
  });
});

describe("action fail paths — calendar", () => {
  let calendarDeleteAction: typeof import("../../actions/calendar-delete.js").default;

  beforeAll(async () => {
    hoisted.testDb = await createTestDb();
    calendarDeleteAction = (await import("../../actions/calendar-delete.js")).default;
  });

  afterAll(async () => {
    if (hoisted.testDb) await hoisted.testDb.close();
    hoisted.testDb = null;
  });

  it("calendar-delete: deleting non-existent id fails with 404", async () => {
    try {
      await calendarDeleteAction.run({ id: "nonexistent-ev-xyz" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isActionContractError(err)).toBe(true);
      expect(err).toHaveProperty("statusCode", 404);
      expect(String((err as Error).message)).toContain("日历条目不存在");
    }
  });
});

describe("action fail paths — outputs-store actions", () => {
  let outputFileSaveAction: typeof import("../../actions/output-file-save.js").default;
  let outputsAction: typeof import("../../actions/outputs.js").default;

  let tmpDir: string;
  let originalOutputsDir: string | undefined;

  beforeAll(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    hoisted.testDb = await createTestDb();
    tmpDir = mkdtempSync(join(tmpdir(), "easel-test-action-outputs-"));
    originalOutputsDir = process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    process.env.EASEL_OUTPUTS_DIR = tmpDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)

    outputFileSaveAction = (await import("../../actions/output-file-save.js")).default;
    outputsAction = (await import("../../actions/outputs.js")).default;
  });

  afterAll(async () => {
    const { rmSync } = await import("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalOutputsDir === undefined) {
      delete process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    } else {
      process.env.EASEL_OUTPUTS_DIR = originalOutputsDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    }
    if (hoisted.testDb) await hoisted.testDb.close();
    hoisted.testDb = null;
  });

  it("output-file-save: path with .. traversal fails", async () => {
    try {
      await outputFileSaveAction.run({ path: "../escape.txt", content: "x" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isActionContractError(err)).toBe(true);
      expect(String((err as Error).message)).toMatch(/不允许|越出|路径/);
    }
  });

  it("output-file-save: absolute path fails", async () => {
    try {
      await outputFileSaveAction.run({ path: "/etc/passwd", content: "x" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isActionContractError(err)).toBe(true);
      expect(String((err as Error).message)).toMatch(/只允许相对|不允许/);
    }
  });

  it("outputs: querying non-existent topic fails with 404", async () => {
    try {
      await outputsAction.run({ topic: "definitely-not-real-topic-xyz" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(isActionContractError(err)).toBe(true);
      expect(err).toHaveProperty("statusCode", 404);
      expect(String((err as Error).message)).toContain("内容项目不存在");
    }
  });
});

describe("action — quality-gate", () => {
  let qualityGateAction: typeof import("../../actions/quality-gate.js").default;

  beforeAll(async () => {
    qualityGateAction = (await import("../../actions/quality-gate.js")).default;
  });

  afterAll(() => {
    // no-op: quality-gate doesn't use DB
  });

  it("quality-gate: pass verdict sets allowedToPublish=true", async () => {
    const result = await qualityGateAction.run({ text: "正常文案内容" });
    expect(result.verdict).toBe("pass");
    expect(result.allowedToPublish).toBe(true);
  });

  it("quality-gate: block verdict sets allowedToPublish=false", async () => {
    const result = await qualityGateAction.run({
      text: "sk-abcdefghijklmnop1234567890",
    });
    expect(result.verdict).toBe("block");
    expect(result.allowedToPublish).toBe(false);
  });

  it("quality-gate: returns platform list when no platform specified", async () => {
    const result = await qualityGateAction.run({ text: "hello" });
    expect(result.platforms).toBeDefined();
    expect(Array.isArray(result.platforms)).toBe(true);
    expect(result.platforms!.length).toBeGreaterThan(0);
  });

  it("quality-gate: does not return platform list when platform specified", async () => {
    const result = await qualityGateAction.run({ text: "hello", platform: "xiaohongshu" });
    expect(result.platforms).toBeUndefined();
  });
});

describe("action read-only — ideas list", () => {
  let ideasAction: typeof import("../../actions/ideas.js").default;

  beforeAll(async () => {
    hoisted.testDb = await createTestDb();
    ideasAction = (await import("../../actions/ideas.js")).default;
  });

  afterAll(async () => {
    if (hoisted.testDb) await hoisted.testDb.close();
    hoisted.testDb = null;
  });

  it("ideas: returns empty array with total=0 for fresh DB", async () => {
    const result = await ideasAction.run({});
    expect(result.ideas).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("ideas: status filter returns empty when no matching ideas", async () => {
    const result = await ideasAction.run({ status: "doing" });
    expect(result.ideas).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("action read-only — profiles list", () => {
  let profilesAction: typeof import("../../actions/profiles.js").default;

  beforeAll(async () => {
    hoisted.testDb = await createTestDb();
    profilesAction = (await import("../../actions/profiles.js")).default;
  });

  afterAll(async () => {
    if (hoisted.testDb) await hoisted.testDb.close();
    hoisted.testDb = null;
  });

  it("profiles: returns empty array with total=0 for fresh DB", async () => {
    const result = await profilesAction.run({});
    expect(result.profiles).toEqual([]);
    expect(result.total).toBe(0);
  });
});
