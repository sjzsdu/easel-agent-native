import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { removeContentItem } from "../server/lib/content-index.js";
import { deleteOutputPath } from "../server/lib/outputs-store.js";

export default defineAction({
  title: "删除内容项目/文件",
  description:
    "删除 outputs/ 下的一个项目目录或文件 (同步移除内容库索引)。破坏性操作, 仅在用户明确要求时使用; `_` 前缀系统目录不可删。",
  schema: z.object({
    path: z
      .string()
      .min(1)
      .describe("相对 outputs/ 的路径; 项目目录名即删除整个项目"),
  }),
  deferLoading: true,
  run: async ({ path }) => {
    try {
      const { deleted } = deleteOutputPath(path);
      const topSegment = deleted.split("/")[0];
      if (topSegment && !deleted.includes("/")) {
        await removeContentItem(getDb(), topSegment);
      }
      return { ok: true, deleted };
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  },
});
