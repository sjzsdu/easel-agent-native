import { desc } from "drizzle-orm";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { contentItems } from "../server/db/schema.js";
import { upsertContentItem } from "../server/lib/content-index.js";
import {
  listProjects,
  listMediaFiles,
  readManifest,
} from "../server/lib/outputs-store.js";

export default defineAction({
  title: "浏览内容库",
  description:
    "列出 outputs/ 下的全部内容项目 (标题/摘要/平台/状态/成品/步骤), 并把文件系统里的 .easel.json 同步进 SQL 索引。传 topic 返回单个项目的 manifest 详情。内容库页、归因复盘、避免重复创作前先调用。",
  schema: z.object({
    topic: z
      .string()
      .optional()
      .describe("项目目录名; 传入则只返回该项目详情"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ topic }) => {
    const db = getDb();

    if (topic) {
      const manifest = readManifest(topic);
      if (!manifest) fail(`内容项目不存在: ${topic}`, { statusCode: 404 });
      const project = listProjects().find((p) => p.topic === topic);
      await upsertContentItem(db, {
        topic,
        manifest,
        fileCount: project?.fileCount,
      });
      if (!project) fail(`内容项目不存在: ${topic}`, { statusCode: 404 });
      return { project: { ...project, mediaFiles: listMediaFiles(topic) } };
    }

    const projects = listProjects();
    for (const project of projects) {
      await upsertContentItem(db, {
        topic: project.topic,
        manifest: project.manifest,
        fileCount: project.fileCount,
      });
    }
    const ordered = [...projects]
      .sort((a, b) =>
        (b.manifest.updated ?? "").localeCompare(a.manifest.updated ?? ""),
      )
      .map((project) => ({
        ...project,
        mediaFiles: listMediaFiles(project.topic),
      }));

    const indexed = await db
      .select({ status: contentItems.status })
      .from(contentItems)
      .orderBy(desc(contentItems.updatedAt));
    const statusCounts: Record<string, number> = {};
    for (const row of indexed) {
      statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    }

    return {
      projects: ordered,
      total: ordered.length,
      statusCounts,
    };
  },
});
