import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { renderCard } from "../server/lib/media/index.js";
import { recordMediaStep } from "../server/lib/media/registry.js";

export default defineAction({
  title: "渲染卡片/封面图",
  description:
    "把 outputs/<主题>/ 里的 HTML 渲染成图片 (包装 render_card.py, playwright 截图)。支持单图 (--out) 与批量 (--all + outDir)。产物落 outputs/<主题>/ 并登记 manifest step; 依赖缺失时返回 unavailable 结构化结果 (缺什么/怎么装), 绝不假装成功。大文件不进 SQL, 只返回路径与预览 URL。",
  schema: z.object({
    topic: z.string().min(1).describe("项目目录名 (outputs/<主题>), 用于 manifest 登记"),
    html: z.string().min(1).describe("相对 outputs/ 的 HTML 文件路径, 如 「我的主题/card.html」"),
    out: z.string().optional().describe("相对 outputs/ 的输出图片路径 (默认与 html 同名换 .png/.jpg)"),
    outDir: z.string().optional().describe("批量模式输出目录 (相对 outputs/, 与 all 搭配)"),
    selector: z.string().optional().describe("要截取的元素 CSS selector (单图模式)"),
    all: z.string().optional().describe("批量模式: 截取命中该 selector 的所有元素"),
    prefix: z.string().optional().describe("批量模式文件名前缀 (默认 card)"),
    fullPage: z.boolean().optional().describe("整页截图 (竖版海报常用)"),
    width: z.number().int().optional().describe("视口宽 (默认 1080)"),
    height: z.number().int().optional().describe("视口高 (默认 1440)"),
    scale: z.number().int().optional().describe("设备像素比, 越高越清晰 (默认 2)"),
    format: z.enum(["png", "jpeg"]).optional().describe("输出格式 (默认 png)"),
    quality: z.number().int().optional().describe("jpeg 质量 1-100 (默认 90)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const result = renderCard({
      htmlRel: args.html,
      outRel: args.out,
      outDirRel: args.outDir,
      selector: args.selector,
      all: args.all,
      prefix: args.prefix,
      fullPage: args.fullPage,
      width: args.width,
      height: args.height,
      scale: args.scale,
      format: args.format,
      quality: args.quality,
    });
    if (result.status === "unavailable") return result;
    if (result.status === "failed") {
      await recordMediaStep({
        topic: args.topic,
        skill: "media-render",
        status: "failed",
        summary: result.message.split("\n")[0] ?? "渲染失败",
      }).catch(() => {});
      fail(result.message);
    }
    await recordMediaStep({
      topic: args.topic,
      skill: "media-render",
      status: "done",
      summary: `渲染 ${result.files.length} 张图片`,
      outputs: result.files.map((f) => f.path),
    }).catch(() => {});
    return { ok: true, status: "done", files: result.files, log: result.log };
  },
});
