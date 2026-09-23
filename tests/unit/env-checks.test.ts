import { describe, expect, it } from "vitest";

import { projectRoot, runDoctor } from "../../server/lib/env-checks.js";

describe("env-checks — runDoctor structure", () => {
  const checks = runDoctor();

  it("returns an array of DoctorCheck objects", () => {
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
  });

  it("each check has required fields", () => {
    for (const c of checks) {
      expect(typeof c.name).toBe("string");
      expect(typeof c.label).toBe("string");
      expect(typeof c.ok).toBe("boolean");
      expect(typeof c.required).toBe("boolean");
      expect(typeof c.detail).toBe("string");
    }
  });

  it("includes expected check names", () => {
    const names = checks.map((c) => c.name);
    expect(names).toContain("node");
    expect(names).toContain("outputs");
    expect(names).toContain("skills");
    expect(names).toContain("database");
    expect(names).toContain("llm");
    expect(names).toContain("ffmpeg");
    expect(names).toContain("python");
  });

  it("node check is required and should pass on this environment", () => {
    const nodeCheck = checks.find((c) => c.name === "node")!;
    expect(nodeCheck.required).toBe(true);
    // Should pass since we're running tests with a compatible node
    expect(nodeCheck.ok).toBe(true);
    expect(nodeCheck.detail).toMatch(/^v\d+/);
  });

  it("outputs check is required and passes (dir is writable or can be created)", () => {
    const outputsCheck = checks.find((c) => c.name === "outputs")!;
    expect(outputsCheck.required).toBe(true);
    expect(outputsCheck.ok).toBe(true);
  });

  it("skills check is required and passes (skills are installed)", () => {
    const skillsCheck = checks.find((c) => c.name === "skills")!;
    expect(skillsCheck.required).toBe(true);
    expect(skillsCheck.ok).toBe(true);
    expect(skillsCheck.detail).toMatch(/\d+ 个技能/);
  });

  it("database check always reports ok (informational)", () => {
    const dbCheck = checks.find((c) => c.name === "database")!;
    expect(dbCheck.required).toBe(true);
    expect(dbCheck.ok).toBe(true);
    expect(dbCheck.detail).toBeTruthy();
  });

  it("ffmpeg and python are optional checks", () => {
    const ffmpeg = checks.find((c) => c.name === "ffmpeg")!;
    const python = checks.find((c) => c.name === "python")!;
    expect(ffmpeg.required).toBe(false);
    expect(python.required).toBe(false);
  });

  it("llm check is optional", () => {
    const llmCheck = checks.find((c) => c.name === "llm")!;
    expect(llmCheck.required).toBe(false);
  });
});

describe("env-checks — projectRoot", () => {
  it("returns a string path", () => {
    const root = projectRoot();
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });

  it("is an absolute path", () => {
    const root = projectRoot();
    // On Unix absolute paths start with /; on Windows with drive letter
    expect(root.startsWith("/") || /^[A-Za-z]:/.test(root)).toBe(true);
  });
});
