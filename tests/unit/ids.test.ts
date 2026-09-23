import { describe, expect, it } from "vitest";

import { newId, nowIso, slugify } from "../../server/lib/ids.js";

describe("ids — newId", () => {
  it("generates a non-empty string", () => {
    const id = newId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("generates unique ids on each call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });

  it("includes prefix when provided", () => {
    const id = newId("idea");
    expect(id.startsWith("idea_")).toBe(true);
  });

  it("default id (no prefix) is 20 chars", () => {
    const id = newId();
    expect(id.length).toBe(20);
  });

  it("prefixed id length = prefix + underscore + 20", () => {
    const id = newId("test");
    expect(id.length).toBe("test_".length + 20);
  });

  it("only contains hex chars (no dashes from UUID)", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]+$/);
  });
});

describe("ids — nowIso", () => {
  it("returns a valid ISO 8601 string", () => {
    const ts = nowIso();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("parses to a valid Date close to now", () => {
    const before = Date.now();
    const ts = nowIso();
    const after = Date.now();
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before - 10);
    expect(parsed).toBeLessThanOrEqual(after + 10);
  });
});

describe("ids — slugify", () => {
  it("lowercases ASCII input", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces non-letter chars with dashes", () => {
    expect(slugify("hello   world!!!")).toBe("hello-world");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("  --test--  ")).toBe("test");
  });

  it("keeps Chinese characters (Unicode letters)", () => {
    expect(slugify("科技数码达人")).toBe("科技数码达人");
  });

  it("handles mixed Chinese and ASCII", () => {
    const s = slugify("科技 Tech 2024");
    expect(s).toContain("科技");
    expect(s).toContain("tech");
    expect(s).toContain("2024");
  });

  it("truncates to 48 chars max", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(48);
  });

  it("returns fallback for empty string", () => {
    const s = slugify("");
    expect(s.length).toBeGreaterThan(0);
    expect(s.startsWith("p-")).toBe(true);
  });

  it("returns fallback for all-special-char string", () => {
    const s = slugify("!!!???###");
    expect(s.length).toBeGreaterThan(0);
    expect(s.startsWith("p-")).toBe(true);
  });

  it("is idempotent for simple strings", () => {
    expect(slugify("hello-world")).toBe("hello-world");
  });

  it("collapses multiple dashes into one", () => {
    expect(slugify("a---b---c")).toBe("a-b-c");
  });
});
