import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { runDoctor } from "../server/lib/env-checks.js";

export default defineAction({
  title: "环境体检",
  description:
    "检查本机运行环境: Node 版本、FFmpeg、Python、outputs 目录可写、技能安装数、数据库连接与 LLM 凭证。用户问「环境有没有问题/doctor/为什么跑不起来」时调用。",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  deferLoading: true,
  run: async () => {
    const checks = runDoctor();
    return {
      ok: checks.filter((c) => c.required).every((c) => c.ok),
      checks,
      checkedAt: new Date().toISOString(),
    };
  },
});
