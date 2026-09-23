import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  groupSkillsByLayer,
  listEaselSkills,
} from "../server/lib/skill-catalog.js";

export default defineAction({
  title: "列出工作流技能",
  description:
    "按五层工作流 (基础/发现/策划/创作/发布/归因) 分组列出全部 Easel 技能及其用途。用户问「你能做什么」「有什么技能」、需要挑选合适技能执行任务时调用。",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const entries = listEaselSkills();
    const layers = groupSkillsByLayer(entries);
    return {
      total: entries.length,
      layers: layers.map((group) => ({
        layer: group.layer,
        label: group.label,
        count: group.skills.length,
        skills: group.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          userInvocable: skill.userInvocable,
          dir: skill.dir,
        })),
      })),
    };
  },
});
