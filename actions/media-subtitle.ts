import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { subtitle } from "../server/lib/media/index.js";
import { recordMediaStep } from "../server/lib/media/registry.js";

export default defineAction({
  title: "字幕处理",
  description:
    "字幕文件的确定性处理 (包装 subtitle_ops.py): parse 解析为 JSON / extract 提取待译文本 / merge 原文+译文合成双语 / build 从 JSON 构建字幕 / convert 格式互转 srt-vtt-ass / burn 烧录或软挂载进视频 (需 ffmpeg)。所有路径相对 outputs/; 产物落 outputs/<主题>/ 并登记 manifest step; 依赖缺失时返回 unavailable (缺什么/怎么装), 绝不假装成功。",
  schema: z.object({
    topic: z.string().min(1).describe("项目目录名 (outputs/<主题>), 用于 manifest 登记"),
    op: z
      .enum(["parse", "extract", "merge", "build", "convert", "burn"])
      .describe("处理操作"),
    input: z.string().optional().describe("相对 outputs/ 的输入文件 (build 用 json 代替)"),
    json: z.string().optional().describe("相对 outputs/ 的 JSON 输入 (仅 build: text + 可选 trans)"),
    trans: z.string().optional().describe("相对 outputs/ 的译文行文件 (仅 merge, 行数=字幕条数)"),
    out: z.string().optional().describe("相对 outputs/ 的输出路径 (parse/extract 省略时结果走返回值 log)"),
    format: z.enum(["srt", "vtt", "ass"]).optional().describe("输出格式 (默认按 out 后缀)"),
    order: z.enum(["orig-top", "trans-top"]).optional().describe("双语字幕排列 (默认 orig-top)"),
    transOnly: z.boolean().optional().describe("只输出译文 (merge/build)"),
    soft: z.boolean().optional().describe("burn: 软字幕 (可开关), 默认硬烧录"),
    forceStyle: z.string().optional().describe("burn: srt 硬烧录样式, 如 Fontsize=24,PrimaryColour=&H00FFFFFF"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const result = subtitle({
      op: args.op,
      inputRel: args.input,
      jsonRel: args.json,
      transRel: args.trans,
      outRel: args.out,
      format: args.format,
      order: args.order,
      transOnly: args.transOnly,
      soft: args.soft,
      forceStyle: args.forceStyle,
    });
    if (result.status === "unavailable") return result;
    if (result.status === "failed") {
      await recordMediaStep({
        topic: args.topic,
        skill: "media-subtitle",
        status: "failed",
        summary: result.message.split("\n")[0] ?? "字幕处理失败",
      }).catch(() => {});
      fail(result.message);
    }
    await recordMediaStep({
      topic: args.topic,
      skill: "media-subtitle",
      status: "done",
      summary:
        result.files.length > 0
          ? `${args.op} → ${result.files.map((f) => f.path).join(", ")}`
          : `${args.op} 完成 (结果见返回值)`,
      outputs: result.files.map((f) => f.path),
    }).catch(() => {});
    return { ok: true, status: "done", files: result.files, log: result.log };
  },
});
