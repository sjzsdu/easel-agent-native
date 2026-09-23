import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { readOutputFile } from "../server/lib/outputs-store.js";

export default defineAction({
  title: "读取内容文件",
  description:
    "读取 outputs/ 下某个文件。文本文件 (md/txt/json/html/srt 等) 返回完整内容供预览或编辑; 图片/视频/音频返回预览 URL。路径相对 outputs/, 如 「我的主题/note.md」。",
  schema: z.object({
    path: z.string().min(1).describe("相对 outputs/ 的文件路径"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ path }) => {
    try {
      return readOutputFile(path);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), {
        statusCode: 404,
      });
    }
  },
});
