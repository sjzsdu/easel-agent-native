import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { speak } from "../server/lib/media/index.js";
import { recordMediaStep } from "../server/lib/media/registry.js";

export default defineAction({
  title: "文字转语音配音",
  description:
    "把文本合成为语音 (包装 tts.py, edge-tts / 配置了 VOICE_PROVIDER 时走闭源引擎)。text 或 file (outputs/ 下的文本文件) 二选一; 可同时产出 SRT 字幕 (subtitle=true)。产物落 outputs/<主题>/ 并登记 manifest step; 依赖缺失时返回 unavailable (缺什么/怎么装), 绝不假装成功。",
  schema: z.object({
    topic: z.string().min(1).describe("项目目录名 (outputs/<主题>), 用于 manifest 登记"),
    text: z.string().optional().describe("要合成的文本 (与 file 二选一)"),
    file: z.string().optional().describe("相对 outputs/ 的文本文件路径 (长文本推荐)"),
    out: z.string().min(1).describe("相对 outputs/ 的输出音频路径, 扩展名决定格式 (mp3/wav/m4a)"),
    voice: z.string().optional().describe("音色 (默认 zh-CN-XiaoxiaoNeural)"),
    engine: z.enum(["auto", "closed", "edge"]).optional().describe("配音引擎 (默认 auto)"),
    rate: z.string().optional().describe("语速, 如 +10% / -20%"),
    volume: z.string().optional().describe("音量, 如 +20% / -10%"),
    pitch: z.string().optional().describe("音调, 如 +2Hz / -5Hz"),
    subtitle: z.string().optional().describe("同时输出 SRT 字幕到此路径 (相对 outputs/)"),
    format: z.enum(["auto", "mp3", "wav", "m4a"]).optional().describe("输出格式 (默认按 out 扩展名)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const result = speak({
      text: args.text,
      fileRel: args.file,
      outRel: args.out,
      voice: args.voice,
      engine: args.engine,
      rate: args.rate,
      volume: args.volume,
      pitch: args.pitch,
      subtitleRel: args.subtitle,
      format: args.format,
    });
    if (result.status === "unavailable") return result;
    if (result.status === "failed") {
      await recordMediaStep({
        topic: args.topic,
        skill: "media-tts",
        status: "failed",
        summary: result.message.split("\n")[0] ?? "TTS 合成失败",
      }).catch(() => {});
      fail(result.message);
    }
    await recordMediaStep({
      topic: args.topic,
      skill: "media-tts",
      status: "done",
      summary: `合成语音 ${result.files.map((f) => f.path).join(", ")}`,
      outputs: result.files.map((f) => f.path),
    }).catch(() => {});
    return { ok: true, status: "done", files: result.files, log: result.log };
  },
});
