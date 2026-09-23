import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  removeContentItem,
  upsertContentItem,
} from "../../server/lib/content-index.js";
import { createTestDb } from "../helpers/test-db.js";

describe("content-index — upsertContentItem", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("inserts a new content item", async () => {
    await upsertContentItem(testDb.db, {
      topic: "test-topic-1",
      manifest: {
        title: "Test Title",
        summary: "A test summary",
        status: "draft",
        kind: "article",
        tags: ["tag1", "tag2"],
        platform: "xiaohongshu",
        profile: "default",
        cover: "cover.jpg",
        deliverables: ["a.md", "b.md"],
        steps: [{ layer: "plan", skill: "test", status: "done" }],
      },
    });

    const [row] = await testDb.db
      .select()
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, "test-topic-1"));

    expect(row).toBeDefined();
    expect(row.id).toBe("test-topic-1");
    expect(row.topic).toBe("test-topic-1");
    expect(row.title).toBe("Test Title");
    expect(row.summary).toBe("A test summary");
    expect(row.status).toBe("draft");
    expect(row.kind).toBe("article");
    expect(row.tags).toEqual(["tag1", "tag2"]);
    expect(row.platform).toBe("xiaohongshu");
    expect(row.profile).toBe("default");
    expect(row.cover).toBe("cover.jpg");
    expect(row.deliverables).toEqual(["a.md", "b.md"]);
    expect(row.steps).toHaveLength(1);
    expect(row.steps[0].layer).toBe("plan");
  });

  it("updates existing content item on conflict (same topic)", async () => {
    await upsertContentItem(testDb.db, {
      topic: "update-test",
      manifest: { title: "Old", status: "draft", kind: "article" },
    });

    await upsertContentItem(testDb.db, {
      topic: "update-test",
      manifest: {
        title: "New",
        summary: "added",
        status: "ready",
        kind: "video",
        tags: ["updated"],
      },
    });

    const rows = await testDb.db
      .select()
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, "update-test"));

    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("New");
    expect(rows[0].summary).toBe("added");
    expect(rows[0].status).toBe("ready");
    expect(rows[0].kind).toBe("video");
    expect(rows[0].tags).toEqual(["updated"]);
  });

  it("defaults unknown kind to 'other'", async () => {
    await upsertContentItem(testDb.db, {
      topic: "kind-default",
      manifest: { title: "T", kind: "weird-unknown-type" as any },
    });

    const [row] = await testDb.db
      .select()
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, "kind-default"));

    expect(row.kind).toBe("other");
  });

  it("defaults unknown status to 'draft'", async () => {
    await upsertContentItem(testDb.db, {
      topic: "status-default",
      manifest: { title: "T", status: "weird-status" as any },
    });

    const [row] = await testDb.db
      .select()
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, "status-default"));

    expect(row.status).toBe("draft");
  });

  it("handles empty manifest fields gracefully", async () => {
    await upsertContentItem(testDb.db, {
      topic: "empty-fields",
      manifest: {},
    });

    const [row] = await testDb.db
      .select()
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, "empty-fields"));

    expect(row.title).toBe("empty-fields"); // falls back to topic
    expect(row.summary).toBe("");
    expect(row.tags).toEqual([]);
    expect(row.deliverables).toEqual([]);
    expect(row.steps).toEqual([]);
    expect(row.kind).toBe("other");
    expect(row.status).toBe("draft");
  });

  it("non-array tags/deliverables/steps default to empty arrays", async () => {
    await upsertContentItem(testDb.db, {
      topic: "non-array",
      manifest: {
        title: "T",
        tags: "not-an-array" as any,
        deliverables: "nope" as any,
        steps: "also-nope" as any,
      },
    });

    const [row] = await testDb.db
      .select()
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, "non-array"));

    expect(row.tags).toEqual([]);
    expect(row.deliverables).toEqual([]);
    expect(row.steps).toEqual([]);
  });
});

describe("content-index — removeContentItem", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("removes an existing content item", async () => {
    await upsertContentItem(testDb.db, {
      topic: "remove-me",
      manifest: { title: "Gone" },
    });

    const before = await testDb.db
      .select()
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, "remove-me"));
    expect(before.length).toBe(1);

    await removeContentItem(testDb.db, "remove-me");

    const after = await testDb.db
      .select()
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, "remove-me"));
    expect(after.length).toBe(0);
  });

  it("idempotent: removing non-existent item does not throw", async () => {
    await expect(
      removeContentItem(testDb.db, "does-not-exist-xyz"),
    ).resolves.not.toThrow();
  });
});

describe("content-index — state transitions (draft → ready → published)", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("advances status through the full lifecycle", async () => {
    const topic = "lifecycle-test";

    // draft (default)
    await upsertContentItem(testDb.db, {
      topic,
      manifest: { title: "Lifecycle", status: "draft", kind: "article" },
    });
    let [row] = await testDb.db
      .select({ status: testDb.schema.contentItems.status })
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, topic));
    expect(row.status).toBe("draft");

    // → ready
    await upsertContentItem(testDb.db, {
      topic,
      manifest: { title: "Lifecycle", status: "ready", kind: "article" },
    });
    [row] = await testDb.db
      .select({ status: testDb.schema.contentItems.status })
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, topic));
    expect(row.status).toBe("ready");

    // → published
    await upsertContentItem(testDb.db, {
      topic,
      manifest: { title: "Lifecycle", status: "published", kind: "article" },
    });
    [row] = await testDb.db
      .select({ status: testDb.schema.contentItems.status })
      .from(testDb.schema.contentItems)
      .where(eq(testDb.schema.contentItems.id, topic));
    expect(row.status).toBe("published");
  });
});
