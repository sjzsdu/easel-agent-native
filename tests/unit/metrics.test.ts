import { describe, expect, it } from "vitest";

import {
  METRIC_KEYS,
  engagementScore,
  engagementTotal,
  normalizeMetrics,
} from "../../server/lib/metrics.js";

describe("normalizeMetrics", () => {
  it("accepts a valid full set", () => {
    const res = normalizeMetrics({
      views: 12000,
      likes: 300,
      collects: 120,
      comments: 45,
      shares: 20,
      followersGained: 15,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.metrics.views).toBe(12000);
      expect(res.metrics.followersGained).toBe(15);
    }
  });

  it("accepts numeric strings and floors decimals (paste-friendly)", () => {
    const res = normalizeMetrics({ likes: "300", views: 1234.9 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.metrics.likes).toBe(300);
      expect(res.metrics.views).toBe(1234); // 向下取整
    }
  });

  it("returns empty metrics for empty input (valid but nothing to save)", () => {
    const res = normalizeMetrics({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.metrics).toEqual({});
  });

  it("rejects unknown keys (whitelist blocks junk/base64)", () => {
    const res = normalizeMetrics({ likes: 1, screenshot: "data:image/png;base64,AAAA" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("不支持的指标字段: screenshot");
  });

  it("rejects negative numbers and non-numeric strings", () => {
    expect(normalizeMetrics({ likes: -1 }).ok).toBe(false);
    expect(normalizeMetrics({ likes: "abc" }).ok).toBe(false);
    expect(normalizeMetrics({ likes: "" }).ok).toBe(false);
    expect(normalizeMetrics({ views: Number.NaN }).ok).toBe(false);
  });

  it("caps absurd values", () => {
    const res = normalizeMetrics({ views: 999_999_999 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("超出合理上限");
  });

  it("keeps the canonical key order for UI rendering", () => {
    expect(METRIC_KEYS).toEqual([
      "views",
      "likes",
      "collects",
      "comments",
      "shares",
      "followersGained",
    ]);
  });
});

describe("engagement scoring", () => {
  it("weights comments > collects/shares > likes", () => {
    expect(engagementScore({ likes: 10 })).toBe(10);
    expect(engagementScore({ collects: 10 })).toBe(20);
    expect(engagementScore({ shares: 10 })).toBe(20);
    expect(engagementScore({ comments: 10 })).toBe(30);
  });

  it("ignores views and followersGained in the interaction score", () => {
    expect(engagementScore({ views: 100000, followersGained: 50 })).toBe(0);
  });

  it("sums interactions excluding views/followersGained", () => {
    expect(
      engagementTotal({ likes: 3, collects: 2, comments: 1, shares: 4, views: 999, followersGained: 9 }),
    ).toBe(10);
  });

  it("treats empty metrics as zero", () => {
    expect(engagementScore({})).toBe(0);
    expect(engagementTotal({})).toBe(0);
  });
});
