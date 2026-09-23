/**
 * 扫描 .agents/skills/<目录>/SKILL.md 的 frontmatter, 为技能库页面与 Agent 提供目录.
 *
 * 只解析我们关心的键: name / description / layer / user-invocable / scope.
 * 框架自己的技能没有 `layer` 键 — 带 layer 的才是 Easel 五层工作流技能.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const EASEL_LAYERS = ["discover", "plan", "produce", "publish", "attribute", "general"] as const;
export type EaselLayer = (typeof EASEL_LAYERS)[number];

export const LAYER_LABELS: Record<EaselLayer, string> = {
  general: "基础能力",
  discover: "发现",
  plan: "策划",
  produce: "创作",
  publish: "发布",
  attribute: "归因",
};

export const LAYER_ORDER: EaselLayer[] = ["general", "discover", "plan", "produce", "publish", "attribute"];

export interface SkillEntry {
  name: string;
  description: string;
  layer: EaselLayer;
  userInvocable: boolean;
  dir: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const values: Record<string, string> = {};
  let currentKey: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentKey) values[currentKey] = buffer.join("\n").trim();
    currentKey = null;
    buffer = [];
  };

  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      flush();
      currentKey = kv[1];
      const raw = kv[2].trim();
      if (["|-", ">", "|", ">-"].includes(raw)) {
        buffer = [];
      } else {
        buffer = [raw.replace(/^["']|["']$/g, "")];
      }
    } else if (currentKey && /^\s+\S/.test(line)) {
      buffer.push(line.trim());
    }
  }
  flush();
  return values;
}

function skillsDir(): string {
  return resolve(process.cwd(), ".agents", "skills");
}

/** 返回所有带 `layer` 的 Easel 工作流技能 (按层分组排序). */
export function listEaselSkills(): SkillEntry[] {
  const dir = skillsDir();
  if (!existsSync(dir)) return [];

  const entries: SkillEntry[] = [];
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    const skillFile = join(dir, child.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const frontmatter = parseFrontmatter(readFileSync(skillFile, "utf8"));
    const layer = frontmatter.layer as EaselLayer | undefined;
    if (!layer || !(EASEL_LAYERS as readonly string[]).includes(layer)) continue;
    if (frontmatter.scope === "dev") continue;

    entries.push({
      name: frontmatter.name || child.name,
      description: frontmatter.description || "",
      layer,
      userInvocable: frontmatter["user-invocable"] !== "false",
      dir: `.agents/skills/${child.name}`,
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export function groupSkillsByLayer(entries: SkillEntry[]): Array<{
  layer: EaselLayer;
  label: string;
  skills: SkillEntry[];
}> {
  return LAYER_ORDER.map((layer) => ({
    layer,
    label: LAYER_LABELS[layer],
    skills: entries.filter((entry) => entry.layer === layer),
  })).filter((group) => group.skills.length > 0);
}
