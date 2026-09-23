import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { transcribe } from "../server/lib/media/index.js";
import { recordMediaStep } from "../server/lib/media/registry.js";

export default defineAction({
  title: "语音转字幕 (ASR)",
  description:
    "音频/视频 → 字幕文件 (包装 asr.py, faster-whisper 本地识别, 视频输入自动提取音轨)。产物落 outputs/<主题>/ 并登记 manifest step; 首次运行会下载模型需外网; 依赖缺失时返回 unavailable (缺什么/怎么装), 绝不假装成功。",
  schema: z.object({
    topic: z.string().min(1).describe("项目目录名 (outputs/<主题>), 用于 manifest 登记"),
    input: z.string().min(1).describe("相对 outputs/ 的音频/视频文件路径"),
    out: z.string().optional().describe("相对 outputs/ 的输出路径 (默认与输入同名换扩展名)"),
    format: z.enum(["srt", "ass", "txt", "json"]).optional().describe("字幕格式 (默认 srt)"),
    model: z.string().optional().describe("模型 tiny/base/small/medium/large-v3 (默认 base)"),
    language: z.string().optional().describe("语言码如 zh/en (默认 auto 自动检测)"),
    maxLineChars: z.number().int().optional().describe("每行字数, 超长自动断行 (中文默认 18)"),
    beamSize: z.number().int().optional().describe("beam search 宽度 (默认 5)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const result = transcribe({
      inputRel: args.input,
      outRel: args.out,
      format: args.format,
      model: args.model,
      language: args.language,
      maxLineChars: args.maxLineChars,
      beamSize: args.beamSize,
    });
    if (result.status === "unavailable") return result;
    if (result.status === "failed") {
      await recordMediaStep({
        topic: args.topic,
        skill: "media-asr",
        status: "failed",
        summary: result.message.split("\n")[0] ?? "ASR 转写失败",
      }).catch(() => {});
      fail(result.message);
    }
    await recordMediaStep({
      topic: args.topic,
      skill: "media-asr",
      status: "done",
      summary: `生成字幕 ${result.files.map((f) => f.path).join(", ")}`,
      outputs: result.files.map((f) => f.path),
    }).catch(() => {});
    return { ok: true, status: "done", files: result.files, log: result.log };
  },
});
