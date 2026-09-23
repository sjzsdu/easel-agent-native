import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { writeOutputFile } from "../server/lib/outputs-store.js";

export default defineAction({
  title: "写入内容文件",
  description:
    "把文本写进 outputs/<主题>/ 下的文件 (整文件覆盖)。创作层落稿、修改文案、写 brief.md 都用它。路径必须相对 outputs/, 不存在的子目录会自动创建。",
  schema: z.object({
    path: z.string().min(1).describe("相对 outputs/ 的文件路径, 如 「我的主题/note.md」"),
    content: z.string().describe("文件完整内容 (UTF-8 文本)"),
  }),
  maxBodyBytes: 8 * 1024 * 1024,
  run: async ({ path, content }) => {
    try {
      const result = writeOutputFile(path, content);
      return { ok: true, ...result };
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  },
});
