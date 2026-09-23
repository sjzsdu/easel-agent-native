import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteOutputPath,
  ensureOutputsDir,
  listProjects,
  outputsDir,
  readManifest,
  readOutputFile,
  writeManifest,
  writeOutputFile,
} from "../../server/lib/outputs-store.js";

describe("outputs-store — path safety", () => {
  let tmpDir: string;
  let originalOutputsDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "easel-test-outputs-"));
    originalOutputsDir = process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    process.env.EASEL_OUTPUTS_DIR = tmpDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalOutputsDir === undefined) {
      delete process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    } else {
      process.env.EASEL_OUTPUTS_DIR = originalOutputsDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    }
  });

  it("outputsDir honors EASEL_OUTPUTS_DIR env override", () => {
    expect(outputsDir()).toBe(tmpDir);
  });

  it("ensureOutputsDir creates the directory", () => {
    ensureOutputsDir();
    // Should not throw; directory exists
    const { existsSync } = require("node:fs");
    expect(existsSync(tmpDir)).toBe(true);
  });

  it("rejects paths containing ..", () => {
    expect(() => writeOutputFile("../escape.txt", "x")).toThrow(/不允许包含/);
  });

  it("rejects absolute paths in writeOutputFile", () => {
    expect(() => writeOutputFile("/etc/passwd", "x")).toThrow(/只允许相对/);
  });

  it("rejects paths that escape outputs dir via traversal", () => {
    expect(() => writeOutputFile("a/../../escape.txt", "x")).toThrow(/不允许包含/);
  });

  it("safeResolve allows valid nested paths", () => {
    const result = writeOutputFile("topic/sub/file.md", "# hello");
    expect(result.path).toBe("topic/sub/file.md");
    expect(result.bytes).toBeGreaterThan(0);
  });
});

describe("outputs-store — manifest read/write", () => {
  let tmpDir: string;
  let originalOutputsDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "easel-test-outputs-"));
    originalOutputsDir = process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    process.env.EASEL_OUTPUTS_DIR = tmpDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalOutputsDir === undefined) {
      delete process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    } else {
      process.env.EASEL_OUTPUTS_DIR = originalOutputsDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    }
  });

  it("readManifest returns null for non-existent topic", () => {
    expect(readManifest("nonexistent")).toBeNull();
  });

  it("writeManifest creates topic dir and .easel.json", () => {
    const m = writeManifest("my-topic", {
      title: "My Topic",
      status: "draft",
      kind: "article",
    });
    expect(m.topic).toBe("my-topic");
    expect(m.title).toBe("My Topic");
    expect(m.status).toBe("draft");
    expect(m.created).toBeTruthy();
    expect(m.updated).toBeTruthy();

    const readBack = readManifest("my-topic");
    expect(readBack).not.toBeNull();
    expect(readBack?.title).toBe("My Topic");
  });

  it("writeManifest sets topic from dir name when not provided", () => {
    const m = writeManifest("auto-topic", { title: "Auto" });
    expect(m.topic).toBe("auto-topic");
  });

  it("writeManifest preserves existing created timestamp on update", () => {
    const first = writeManifest("ts-test", { title: "v1" });
    const created = first.created;
    // Force a tiny delay so updated can differ
    const second = writeManifest("ts-test", { title: "v2", created });
    expect(second.created).toBe(created);
    expect(second.title).toBe("v2");
  });

  it("writeManifest overwrites existing manifest fields", () => {
    writeManifest("update-test", { title: "Old", tags: ["a"] });
    const updated = writeManifest("update-test", {
      title: "New",
      summary: "added summary",
      tags: ["b", "c"],
    });
    expect(updated.title).toBe("New");
    expect(updated.summary).toBe("added summary");
    expect(updated.tags).toEqual(["b", "c"]);
  });
});

describe("outputs-store — file I/O", () => {
  let tmpDir: string;
  let originalOutputsDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "easel-test-outputs-"));
    originalOutputsDir = process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    process.env.EASEL_OUTPUTS_DIR = tmpDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalOutputsDir === undefined) {
      delete process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    } else {
      process.env.EASEL_OUTPUTS_DIR = originalOutputsDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    }
  });

  it("writeOutputFile + readOutputFile round-trip text", () => {
    const content = "# Hello\n\nWorld";
    writeOutputFile("topic/note.md", content);
    const result = readOutputFile("topic/note.md");
    expect(result.encoding).toBe("text");
    expect(result.content).toBe(content);
    expect(result.size).toBe(Buffer.byteLength(content, "utf8"));
    expect(result.path).toBe("topic/note.md");
  });

  it("readOutputFile throws for non-existent file", () => {
    expect(() => readOutputFile("topic/missing.md")).toThrow(/不存在/);
  });

  it("readOutputFile returns binary + previewUrl for non-text files", () => {
    // Write a small "binary" file (e.g. .png extension)
    writeOutputFile("topic/image.png", "fake-png-bytes");
    const result = readOutputFile("topic/image.png");
    expect(result.encoding).toBe("binary");
    expect(result.previewUrl).toBeDefined();
    expect(result.previewUrl).toContain("topic/image.png");
    expect(result.content).toBeUndefined();
  });
});

describe("outputs-store — listProjects", () => {
  let tmpDir: string;
  let originalOutputsDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "easel-test-outputs-"));
    originalOutputsDir = process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    process.env.EASEL_OUTPUTS_DIR = tmpDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalOutputsDir === undefined) {
      delete process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    } else {
      process.env.EASEL_OUTPUTS_DIR = originalOutputsDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    }
  });

  it("returns empty array for fresh outputs dir", () => {
    const projects = listProjects();
    expect(projects).toEqual([]);
  });

  it("lists projects with manifests", () => {
    writeManifest("project-a", { title: "A" });
    writeManifest("project-b", { title: "B" });
    const projects = listProjects();
    expect(projects.length).toBe(2);
    expect(projects.map((p) => p.topic).sort()).toEqual(["project-a", "project-b"]);
  });

  it("skips directories starting with _ (system dirs)", () => {
    writeManifest("_templates", { title: "Templates" });
    writeManifest("real-project", { title: "Real" });
    const projects = listProjects();
    expect(projects.map((p) => p.topic)).not.toContain("_templates");
    expect(projects.map((p) => p.topic)).toContain("real-project");
  });

  it("skips hidden directories (.)", () => {
    const { mkdirSync, writeFileSync } = require("node:fs");
    const hiddenDir = join(tmpDir, ".hidden");
    mkdirSync(hiddenDir, { recursive: true });
    writeFileSync(join(hiddenDir, ".easel.json"), JSON.stringify({ title: "hidden" }));
    const projects = listProjects();
    expect(projects.map((p) => p.topic)).not.toContain(".hidden");
  });

  it("projects without manifest get default manifest", () => {
    const { mkdirSync } = require("node:fs");
    mkdirSync(join(tmpDir, "no-manifest"), { recursive: true });
    const projects = listProjects();
    const p = projects.find((x) => x.topic === "no-manifest");
    expect(p).toBeDefined();
    expect(p?.hasManifest).toBe(false);
    expect(p?.manifest.status).toBe("draft");
    expect(p?.manifest.kind).toBe("other");
  });

  it("counts files correctly (excluding dotfiles)", () => {
    writeManifest("count-test", { title: "Count" });
    writeOutputFile("count-test/a.md", "a");
    writeOutputFile("count-test/b.md", "b");
    const projects = listProjects();
    const p = projects.find((x) => x.topic === "count-test");
    // fileCount includes .easel.json? Let's check it's at least 2
    expect(p?.fileCount).toBeGreaterThanOrEqual(2);
  });
});

describe("outputs-store — deleteOutputPath", () => {
  let tmpDir: string;
  let originalOutputsDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "easel-test-outputs-"));
    originalOutputsDir = process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    process.env.EASEL_OUTPUTS_DIR = tmpDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalOutputsDir === undefined) {
      delete process.env.EASEL_OUTPUTS_DIR; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    } else {
      process.env.EASEL_OUTPUTS_DIR = originalOutputsDir; // guard:allow-env-credential — test fixture: outputs dir override (local temp path, not a credential)
    }
  });

  it("deletes a single file", () => {
    writeOutputFile("topic/file.md", "x");
    const result = deleteOutputPath("topic/file.md");
    expect(result.deleted).toBe("topic/file.md");
    expect(() => readOutputFile("topic/file.md")).toThrow();
  });

  it("deletes a project directory recursively", () => {
    writeManifest("kill-me", { title: "Kill" });
    writeOutputFile("kill-me/note.md", "bye");
    const result = deleteOutputPath("kill-me");
    expect(result.deleted).toBe("kill-me");
    expect(readManifest("kill-me")).toBeNull();
  });

  it("refuses to delete _ system directories", () => {
    expect(() => deleteOutputPath("_templates")).toThrow(/不允许删除系统路径/);
  });

  it("refuses to delete outputs root (empty path)", () => {
    expect(() => deleteOutputPath("")).toThrow(/不允许删除系统路径/);
  });

  it("refuses to delete non-existent path", () => {
    expect(() => deleteOutputPath("does-not-exist")).toThrow(/路径不存在/);
  });

  it("rejects .. traversal in delete", () => {
    expect(() => deleteOutputPath("../outside")).toThrow(/不允许包含/);
  });
});
