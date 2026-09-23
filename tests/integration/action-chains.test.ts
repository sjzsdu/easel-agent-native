/**
 * Integration tests: key action chains end-to-end against a real PGlite DB.
 *
 * These exercise multi-action workflows that mirror real agent usage:
 *   1. profile-save → profile read back
 *   2. idea-save → ideas list → idea-delete
 *   3. calendar full lifecycle + state transitions
 *
 * Uses a single shared PGlite instance per describe block for speed; tables
 * are not truncated between tests because each test uses unique ids.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb } from "../helpers/test-db.js";

const hoisted = vi.hoisted(() => ({
  testDb: null as Awaited<ReturnType<typeof createTestDb>> | null,
}));

vi.mock("../../server/db/index.js", () => ({
  getDb: () => {
    if (!hoisted.testDb) throw new Error("testDb not initialized");
    return hoisted.testDb.db;
  },
}));

describe("integration — profile lifecycle (save → read → list → delete)", () => {
  let profileSave: typeof import("../../actions/profile-save.js").default;
  let profileRead: typeof import("../../actions/profile.js").default;
  let profilesList: typeof import("../../actions/profiles.js").default;
  let profileDelete: typeof import("../../actions/profile-delete.js").default;
  let profileSetActive: typeof import("../../actions/profile-set-active.js").default;

  beforeAll(async () => {
    hoisted.testDb = await createTestDb();
    profileSave = (await import("../../actions/profile-save.js")).default;
    profileRead = (await import("../../actions/profile.js")).default;
    profilesList = (await import("../../actions/profiles.js")).default;
    profileDelete = (await import("../../actions/profile-delete.js")).default;
    profileSetActive = (await import("../../actions/profile-set-active.js")).default;
  });

  afterAll(async () => {
    if (hoisted.testDb) await hoisted.testDb.close();
    hoisted.testDb = null;
  });

  it("creates a profile and reads it back by id", async () => {
    const saveResult = await profileSave.run({
      name: "科技数码达人",
      identity: "专注数码产品测评的科技博主",
      style: "理性客观、数据说话、对比表格多",
      audience: "18-35 岁男性数码爱好者",
      platforms: "B站: @techguru\n小红书: @techguru",
      preferences: "不做医疗/金融内容；不蹭明星八卦",
      memory: "测评视频点赞率最高的是手机续航对比",
    });

    expect(saveResult.created).toBe(true);
    expect(saveResult.profile.id).toBeTruthy();
    expect(saveResult.profile.name).toBe("科技数码达人");
    expect(saveResult.profile.active).toBe(true); // first profile auto-activated

    const readResult = await profileRead.run({ id: saveResult.profile.id });
    expect(readResult.profile).not.toBeNull();
    expect(readResult.profile!.name).toBe("科技数码达人");
    expect(readResult.profile!.identity).toBe("专注数码产品测评的科技博主");
    expect(readResult.profile!.style).toBe("理性客观、数据说话、对比表格多");
    expect(readResult.profile!.audience).toBe("18-35 岁男性数码爱好者");
    expect(readResult.profile!.platforms).toContain("B站");
    expect(readResult.profile!.preferences).toContain("不做医疗");
    expect(readResult.profile!.memory).toContain("手机续航对比");
  });

  it("slugifies name as default id", async () => {
    const result = await profileSave.run({
      name: "美食探店",
    });
    // slugify produces Chinese-safe slugs
    expect(result.profile.id).toBeTruthy();
    expect(result.created).toBe(true);
  });

  it("updates an existing profile and reads changes back", async () => {
    const created = await profileSave.run({
      name: "更新测试账号",
      identity: "初始定位",
    });
    const id = created.profile.id;

    const updated = await profileSave.run({
      id,
      name: "更新测试账号 v2",
      identity: "新定位",
      style: "新风格",
    });

    expect(updated.created).toBe(false);
    expect(updated.profile.name).toBe("更新测试账号 v2");
    expect(updated.profile.identity).toBe("新定位");
    expect(updated.profile.style).toBe("新风格");

    const readBack = await profileRead.run({ id });
    expect(readBack.profile!.name).toBe("更新测试账号 v2");
    expect(readBack.profile!.identity).toBe("新定位");
  });

  it("lists all profiles with summary fields", async () => {
    await profileSave.run({ name: "Profile A", identity: "a" });
    await profileSave.run({ name: "Profile B", identity: "b" });

    const list = await profilesList.run({});
    expect(list.total).toBeGreaterThanOrEqual(2);
    expect(list.profiles.length).toBe(list.total);

    for (const p of list.profiles) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(typeof p.active).toBe("boolean");
      expect(typeof p.hasIdentity).toBe("boolean");
      expect(typeof p.hasStyle).toBe("boolean");
      expect(typeof p.hasAudience).toBe("boolean");
    }
  });

  it("profile without id returns active profile", async () => {
    const created = await profileSave.run({
      name: "默认激活账号",
      identity: "默认定位",
      makeActive: true,
    });

    const readResult = await profileRead.run({});
    expect(readResult.profile).not.toBeNull();
    expect(readResult.profile!.id).toBe(created.profile.id);
    expect(readResult.profile!.active).toBe(true);
  });

  it("profile-set-active changes which profile is active", async () => {
    // Create both profiles (new profiles auto-activate, so second is active)
    const first = await profileSave.run({
      name: "第一个账号",
      identity: "first",
    });
    const second = await profileSave.run({
      name: "第二个账号",
      identity: "second",
    });

    // Verify second is currently active (newest = active)
    let active = await profileRead.run({});
    expect(active.profile!.id).toBe(second.profile.id);

    // Switch to first
    const setResult = await profileSetActive.run({ id: first.profile.id });
    expect(setResult.ok).toBe(true);
    expect(setResult.activeId).toBe(first.profile.id);

    active = await profileRead.run({});
    expect(active.profile!.id).toBe(first.profile.id);

    // Second should no longer be active
    const secondRead = await profileRead.run({ id: second.profile.id });
    expect(secondRead.profile!.active).toBe(false);
  });

  it("deletes a profile and confirms it's gone", async () => {
    const created = await profileSave.run({
      name: "待删除账号",
      identity: "bye",
    });
    const id = created.profile.id;

    const deleteResult = await profileDelete.run({ id });
    expect(deleteResult.ok).toBe(true);
    expect(deleteResult.id).toBe(id);

    // Reading after delete should fail with 404
    try {
      await profileRead.run({ id });
      expect.unreachable("should have thrown 404");
    } catch (err) {
      expect(String((err as Error).message)).toContain("画像不存在");
    }
  });
});

describe("integration — ideas lifecycle (save → list → update → delete)", () => {
  let ideaSave: typeof import("../../actions/idea-save.js").default;
  let ideasList: typeof import("../../actions/ideas.js").default;
  let ideaDelete: typeof import("../../actions/idea-delete.js").default;

  beforeAll(async () => {
    hoisted.testDb = await createTestDb();
    ideaSave = (await import("../../actions/idea-save.js")).default;
    ideasList = (await import("../../actions/ideas.js")).default;
    ideaDelete = (await import("../../actions/idea-delete.js")).default;
  });

  afterAll(async () => {
    if (hoisted.testDb) await hoisted.testDb.close();
    hoisted.testDb = null;
  });

  it("creates ideas and lists them in order", async () => {
    await ideaSave.run({ title: "选题 A", note: "备注 A", source: "热点" });
    await ideaSave.run({ title: "选题 B", note: "备注 B", status: "doing" });
    await ideaSave.run({ title: "选题 C", status: "done" });

    const list = await ideasList.run({});
    expect(list.total).toBe(3);
    expect(list.ideas.length).toBe(3);

    // Default status is pending
    const a = list.ideas.find((i) => i.title === "选题 A")!;
    expect(a.status).toBe("pending");
    expect(a.note).toBe("备注 A");
    expect(a.source).toBe("热点");

    // Custom statuses preserved
    expect(list.ideas.find((i) => i.title === "选题 B")!.status).toBe("doing");
    expect(list.ideas.find((i) => i.title === "选题 C")!.status).toBe("done");
  });

  it("filters ideas by status", async () => {
    const pending = await ideasList.run({ status: "pending" });
    expect(pending.ideas.every((i) => i.status === "pending")).toBe(true);

    const doing = await ideasList.run({ status: "doing" });
    expect(doing.ideas.every((i) => i.status === "doing")).toBe(true);

    const done = await ideasList.run({ status: "done" });
    expect(done.ideas.every((i) => i.status === "done")).toBe(true);
  });

  it("updates an idea's title and status", async () => {
    const created = await ideaSave.run({ title: "原始标题" });
    const id = created.idea.id;

    const updated = await ideaSave.run({
      id,
      title: "更新后的标题",
      status: "doing",
      note: "加了备注",
    });

    expect(updated.idea.title).toBe("更新后的标题");
    expect(updated.idea.status).toBe("doing");
    expect(updated.idea.note).toBe("加了备注");

    const list = await ideasList.run({});
    const found = list.ideas.find((i) => i.id === id)!;
    expect(found.title).toBe("更新后的标题");
    expect(found.status).toBe("doing");
  });

  it("advances idea through kanban columns (pending → doing → done)", async () => {
    const created = await ideaSave.run({ title: "看板流转测试" });
    const id = created.idea.id;
    expect(created.idea.status).toBe("pending");

    // → doing
    let updated = await ideaSave.run({ id, title: "看板流转测试", status: "doing" });
    expect(updated.idea.status).toBe("doing");

    // → done
    updated = await ideaSave.run({ id, title: "看板流转测试", status: "done" });
    expect(updated.idea.status).toBe("done");
  });

  it("sets and clears scheduled date", async () => {
    const created = await ideaSave.run({
      title: "排期测试",
      scheduledDate: "2026-10-01",
    });
    expect(created.idea.scheduledDate).toBe("2026-10-01");

    // Clear with empty string
    const cleared = await ideaSave.run({
      id: created.idea.id,
      title: "排期测试",
      scheduledDate: "",
    });
    expect(cleared.idea.scheduledDate).toBeNull();
  });

  it("deletes an idea and confirms removal", async () => {
    const created = await ideaSave.run({ title: "待删除选题" });
    const id = created.idea.id;

    const result = await ideaDelete.run({ id });
    expect(result.ok).toBe(true);
    expect(result.id).toBe(id);

    const list = await ideasList.run({});
    expect(list.ideas.find((i) => i.id === id)).toBeUndefined();
  });
});

describe("integration — calendar lifecycle (save → state transitions → delete)", () => {
  let calendarSave: typeof import("../../actions/calendar-save.js").default;
  let calendarList: typeof import("../../actions/calendar.js").default;
  let calendarDelete: typeof import("../../actions/calendar-delete.js").default;

  beforeAll(async () => {
    hoisted.testDb = await createTestDb();
    calendarSave = (await import("../../actions/calendar-save.js")).default;
    calendarList = (await import("../../actions/calendar.js")).default;
    calendarDelete = (await import("../../actions/calendar-delete.js")).default;
  });

  afterAll(async () => {
    if (hoisted.testDb) await hoisted.testDb.close();
    hoisted.testDb = null;
  });

  it("creates a content calendar entry with default status=draft", async () => {
    const result = await calendarSave.run({
      title: "国庆选题",
      date: "2026-10-01",
      platform: "xiaohongshu",
      note: "国庆热点内容",
    });

    expect(result.event.id).toBeTruthy();
    expect(result.event.title).toBe("国庆选题");
    expect(result.event.date).toBe("2026-10-01");
    expect(result.event.kind).toBe("content");
    expect(result.event.status).toBe("draft");
    expect(result.event.platform).toBe("xiaohongshu");
    expect(result.event.note).toBe("国庆热点内容");
  });

  it("creates an event-type calendar entry", async () => {
    const result = await calendarSave.run({
      title: "双十一",
      date: "2026-11-11",
      kind: "event",
      eventType: "ecommerce",
    });

    expect(result.event.kind).toBe("event");
    expect(result.event.eventType).toBe("ecommerce");
  });

  it("advances content through status lifecycle: idea → draft → ready → published", async () => {
    const created = await calendarSave.run({
      title: "状态流转测试",
      date: "2026-10-01",
      status: "idea",
    });
    const id = created.event.id;
    expect(created.event.status).toBe("idea");

    // → draft
    let updated = await calendarSave.run({
      id,
      title: "状态流转测试",
      date: "2026-10-01",
      status: "draft",
    });
    expect(updated.event.status).toBe("draft");

    // → ready
    updated = await calendarSave.run({
      id,
      title: "状态流转测试",
      date: "2026-10-01",
      status: "ready",
    });
    expect(updated.event.status).toBe("ready");

    // → published
    updated = await calendarSave.run({
      id,
      title: "状态流转测试",
      date: "2026-10-01",
      status: "published",
      url: "https://example.com/published",
    });
    expect(updated.event.status).toBe("published");
    expect(updated.event.url).toBe("https://example.com/published");
  });

  it("lists calendar entries", async () => {
    await calendarSave.run({ title: "条目 1", date: "2026-10-01" });
    await calendarSave.run({ title: "条目 2", date: "2026-10-02" });
    await calendarSave.run({
      title: "电商节",
      date: "2026-11-11",
      kind: "event",
      eventType: "ecommerce",
    });

    const list = await calendarList.run({});
    expect(list.events.length).toBeGreaterThanOrEqual(3);
    expect(list.total).toBeGreaterThanOrEqual(3);

    // Each event has required fields
    for (const ev of list.events) {
      expect(ev.id).toBeTruthy();
      expect(ev.title).toBeTruthy();
      expect(ev.date).toBeTruthy();
      expect(ev.kind).toMatch(/^(content|event)$/);
    }
  });

  it("deletes a calendar entry", async () => {
    const created = await calendarSave.run({
      title: "待删除条目",
      date: "2026-12-01",
    });
    const id = created.event.id;

    const result = await calendarDelete.run({ id });
    expect(result.ok).toBe(true);
    expect(result.id).toBe(id);

    const list = await calendarList.run({});
    expect(list.events.find((e) => e.id === id)).toBeUndefined();
  });

  it("links calendar entry to an idea via ideaId", async () => {
    // First create an idea
    const ideaSave = (await import("../../actions/idea-save.js")).default;
    const idea = await ideaSave.run({ title: "关联选题" });

    // Create a calendar event linked to the idea
    const cal = await calendarSave.run({
      title: "关联选题的排期",
      date: "2026-10-15",
      ideaId: idea.idea.id,
    });

    expect(cal.event.ideaId).toBe(idea.idea.id);
  });
});
