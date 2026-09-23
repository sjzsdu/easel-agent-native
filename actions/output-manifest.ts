import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { upsertContentItem } from "../server/lib/content-index.js";
import {
  readManifest,
  type EaselManifestStep,
  writeManifest,
} from "../server/lib/outputs-store.js";

export default defineAction({
  title: "更新项目 manifest",
  description:
    "更新 outputs/<主题>/.easel.json 的展示头 (标题/摘要/平台/状态/标签/封面/成品), 或追加一个层间步骤 (steps) 记录。创作完成改 status=ready、发布后改 published、每完成一层工作 record 一个 step 都用它。",
  schema: z.object({
    topic: z.string().min(1).describe("项目目录名 (outputs/<主题>)"),
    title: z.string().optional().describe("展示标题"),
    summary: z.string().optional().describe("一句话摘要"),
    platform: z.string().optional().describe("目标平台"),
    kind: z
      .enum(["article", "xhs-note", "video", "cards", "poster", "audio", "other"])
      .optional()
      .describe("产物类型"),
    status: z
      .enum(["draft", "ready", "published"])
      .optional()
      .describe("项目状态"),
    tags: z.array(z.string()).optional().describe("标签, 整体替换"),
    cover: z.string().optional().describe("封面文件相对路径"),
    deliverables: z
      .array(z.string())
      .optional()
      .describe("成品文件相对路径列表, 整体替换"),
    profile: z.string().optional().describe("使用的画像名"),
    step: z
      .object({
        layer: z.string().describe("discover/plan/produce/publish/attribute/general"),
        skill: z.string().describe("执行的技能名"),
        status: z.enum(["done", "failed"]).describe("步骤结果"),
        summary: z.string().optional().describe("一行结果摘要"),
        outputs: z.array(z.string()).optional().describe("本步产出的文件路径"),
      })
      .optional()
      .describe("追加一条层间步骤记录 (失败也要记)"),
  }),
  run: async (args) => {
    try {
      const existing = readManifest(args.topic) ?? {
        topic: args.topic,
        created: new Date().toISOString(),
      };

      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.summary !== undefined) patch.summary = args.summary;
      if (args.platform !== undefined) patch.platform = args.platform;
      if (args.kind !== undefined) patch.kind = args.kind;
      if (args.status !== undefined) patch.status = args.status;
      if (args.tags !== undefined) patch.tags = args.tags;
      if (args.cover !== undefined) patch.cover = args.cover;
      if (args.deliverables !== undefined) patch.deliverables = args.deliverables;
      if (args.profile !== undefined) patch.profile = args.profile;

      const steps = Array.isArray(existing.steps) ? [...existing.steps] : [];
      if (args.step) {
        const step: EaselManifestStep = {
          layer: args.step.layer,
          skill: args.step.skill,
          status: args.step.status,
          at: new Date().toISOString(),
          summary: args.step.summary,
          outputs: args.step.outputs,
        };
        steps.push(step);
      }

      const manifest = writeManifest(args.topic, {
        ...existing,
        ...patch,
        steps,
      } as typeof existing & Record<string, unknown>);

      await upsertContentItem(getDb(), { topic: args.topic, manifest });
      return { ok: true, manifest };
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  },
});
