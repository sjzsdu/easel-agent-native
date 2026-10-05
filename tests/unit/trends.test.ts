import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Trends has a module-level Map cache; we reset modules between describe blocks
// so each test group gets a fresh cache.

let TREND_PLATFORMS: typeof import("../../server/lib/trends.js").TREND_PLATFORMS;
let getTrends: typeof import("../../server/lib/trends.js").getTrends;

async function importFresh() {
  vi.resetModules();
  const mod = await import("../../server/lib/trends.js");
  TREND_PLATFORMS = mod.TREND_PLATFORMS;
  getTrends = mod.getTrends;
}

describe("trends — TREND_PLATFORMS", () => {
  beforeEach(async () => {
    await importFresh();
  });

  it("has at least 6 platforms defined", () => {
    expect(TREND_PLATFORMS.length).toBeGreaterThanOrEqual(6);
  });

  it("each platform has key, label, primary URL", () => {
    for (const p of TREND_PLATFORMS) {
      expect(p.key).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.primary).toMatch(/^https?:\/\//);
    }
  });

  it("keys are unique", () => {
    const keys = TREND_PLATFORMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes expected platforms", () => {
    const keys = TREND_PLATFORMS.map((p) => p.key);
    expect(keys).toContain("weibo");
    expect(keys).toContain("douyin");
    expect(keys).toContain("zhihu");
    expect(keys).toContain("bili");
    expect(keys).toContain("baidu");
    expect(keys).toContain("toutiao");
  });

  it("some platforms have fallback URLs", () => {
    const withFallback = TREND_PLATFORMS.filter((p) => p.fallback);
    expect(withFallback.length).toBeGreaterThan(0);
    for (const p of withFallback) {
      expect(p.fallback).toMatch(/^https?:\/\//);
    }
  });

  it("bili declares the official bilibili API as extra fallback", () => {
    const bili = TREND_PLATFORMS.find((p) => p.key === "bili");
    expect(bili?.extraFallback?.source).toBe("official");
    expect(bili?.extraFallback?.url).toMatch(
      /^https:\/\/api\.bilibili\.com\/.+/,
    );
  });

  it("only bili has an extra fallback", () => {
    const withExtra = TREND_PLATFORMS.filter((p) => p.extraFallback);
    expect(withExtra.map((p) => p.key)).toEqual(["bili"]);
  });
});

describe("trends — getTrends (mocked fetch)", () => {
  beforeEach(async () => {
    await importFresh();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns result structure even when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network error"))),
    );

    const result = await getTrends(["weibo"]);
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.results.length).toBe(1);
    expect(result.results[0].platform).toBe("weibo");
    expect(result.results[0].label).toBe("微博");
    expect(result.results[0].source).toBe(null);
    expect(result.results[0].items).toEqual([]);
    expect(result.results[0].error).toBeDefined();
  });

  it("parses 60s API v2 response format (data array)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { title: "热点一", hot: 12345, url: "https://example.com/1" },
                { title: "热点二", hot: 9876, url: "https://example.com/2" },
                { title: "热点三", hot: 5432 },
              ],
            }),
        }),
      ),
    );

    const result = await getTrends(["weibo"]);
    expect(result.results[0].items.length).toBe(3);
    expect(result.results[0].items[0].rank).toBe(1);
    expect(result.results[0].items[0].title).toBe("热点一");
    expect(result.results[0].items[0].hot).toBe(12345);
    expect(result.results[0].items[0].url).toBe("https://example.com/1");
    expect(result.results[0].source).toBe("60s");
  });

  it("handles nested data.data format", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                data: [
                  { title: "Nested 1" },
                  { title: "Nested 2" },
                ],
              },
            }),
        }),
      ),
    );

    const result = await getTrends(["zhihu"]);
    expect(result.results[0].items.length).toBe(2);
    expect(result.results[0].items[0].title).toBe("Nested 1");
  });

  it("handles list format (fallback API)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              list: [
                { word: "List item 1", hot: "10000" },
                { word: "List item 2", hot: "5000" },
              ],
            }),
        }),
      ),
    );

    const result = await getTrends(["baidu"]);
    expect(result.results[0].items.length).toBe(2);
    expect(result.results[0].items[0].title).toBe("List item 1");
    expect(result.results[0].items[0].hot).toBe("10000");
  });

  it("normalizes alternative title fields (name, word, query)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { name: "Name field" },
                { word: "Word field" },
                { query: "Query field" },
                { title: "Title field" },
              ],
            }),
        }),
      ),
    );

    const result = await getTrends(["bili"]);
    const titles = result.results[0].items.map((i) => i.title);
    expect(titles).toContain("Name field");
    expect(titles).toContain("Word field");
    expect(titles).toContain("Query field");
    expect(titles).toContain("Title field");
  });

  it("normalizes alternative URL fields (mobile_url, link)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { title: "A", mobile_url: "https://m.example.com" },
                { title: "B", link: "https://link.example.com" },
                { title: "C", url: "https://url.example.com" },
              ],
            }),
        }),
      ),
    );

    const result = await getTrends(["weibo"]);
    const urls = result.results[0].items.map((i) => i.url);
    expect(urls).toContain("https://m.example.com");
    expect(urls).toContain("https://link.example.com");
    expect(urls).toContain("https://url.example.com");
  });

  it("skips items without a title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { title: "Good one" },
                { notitle: "oops" },
                null,
                { title: "" },
                { title: "Another good one" },
              ],
            }),
        }),
      ),
    );

    const result = await getTrends(["douyin"]);
    const titles = result.results[0].items.map((i) => i.title);
    expect(titles).toEqual(["Good one", "Another good one"]);
  });

  it("caps items at 50", async () => {
    const manyItems = Array.from({ length: 100 }, (_, i) => ({
      title: `Item ${i + 1}`,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: manyItems }),
        }),
      ),
    );

    const result = await getTrends(["toutiao"]);
    expect(result.results[0].items.length).toBe(50);
  });

  it("parses plain-string entries (xxapi style)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: ["纯字符串话题一", "纯字符串话题二", "  "],
            }),
        }),
      ),
    );

    const result = await getTrends(["bili"]);
    expect(result.results[0].source).toBe("60s");
    const titles = result.results[0].items.map((i) => i.title);
    expect(titles).toEqual(["纯字符串话题一", "纯字符串话题二"]);
    expect(result.results[0].items[0].rank).toBe(1);
  });

  it("parses official bilibili trending shape (data.trending.list)", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount++;
        // 60s 500 -> xxapi 空 -> 官方接口成功
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        if (callCount === 2) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              code: 0,
              data: {
                trending: {
                  list: [
                    { keyword: "话题甲", show_name: "话题甲", heat_score: 451714 },
                    { keyword: "话题乙", show_name: "话题乙", heat_score: 120000 },
                  ],
                },
              },
            }),
        });
      }),
    );

    const result = await getTrends(["bili"]);
    expect(callCount).toBe(3);
    expect(result.results[0].source).toBe("official");
    expect(result.results[0].items.length).toBe(2);
    expect(result.results[0].items[0].title).toBe("话题甲");
    expect(result.results[0].items[0].hot).toBe(451714);
  });

  it("normalizes keyword/show_name/heat_score aliases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                trending: {
                  list: [{ keyword: "关键词标题", heat_score: 999 }],
                },
              },
            }),
        }),
      ),
    );

    const result = await getTrends(["weibo"]);
    expect(result.results[0].items[0].title).toBe("关键词标题");
    expect(result.results[0].items[0].hot).toBe(999);
  });

  it("falls back to secondary source when primary fails", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ title: "Fallback result" }],
            }),
        });
      }),
    );

    // Use a platform that has a fallback
    const result = await getTrends(["weibo"]);
    expect(callCount).toBe(2);
    expect(result.results[0].source).toBe("xxapi");
    expect(result.results[0].items.length).toBe(1);
  });

  it("returns all platforms when no platformKeys specified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ title: "x" }] }),
        }),
      ),
    );

    const result = await getTrends();
    expect(result.results.length).toBe(TREND_PLATFORMS.length);
  });

  it("HTTP non-ok response triggers error path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 404, statusText: "Not Found" }),
      ),
    );

    // Use a platform with NO fallback to guarantee no source
    const result = await getTrends(["zhihu"]);
    expect(result.results[0].source).toBe(null);
    expect(result.results[0].error).toBeDefined();
  });

  it("uses cache on second call within TTL", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ title: `call-${callCount}` }] }),
        });
      }),
    );

    const first = await getTrends(["weibo"]);
    const second = await getTrends(["weibo"]);

    // Only one fetch call — second was cached
    expect(callCount).toBe(1);
    expect(second.results[0].source).toBe("cache");
    // Same data as first call
    expect(second.results[0].items[0].title).toBe(first.results[0].items[0].title);
  });
});
