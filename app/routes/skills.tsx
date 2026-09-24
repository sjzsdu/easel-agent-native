import { useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_TITLE } from "@/lib/app-config";
import { askAgent } from "@/lib/easel";

export function meta() {
  return [{ title: `技能库 — ${APP_TITLE}` }];
}

export default function SkillsRoute() {
  useSetPageTitle("技能库");
  const query = useActionQuery("skills-list", {});
  const layers = query.data?.layers ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 lg:p-6">
      {query.isPending ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-5 w-32" />
              {Array.from({ length: 3 }).map((__, j) => (
                <Skeleton key={j} className="h-12" />
              ))}
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-muted-foreground text-sm">技能目录读取失败，请刷新重试。</p>
      ) : (query.data?.total ?? 0) === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed p-8 text-center text-sm">
          还没有安装 Easel 工作流技能 — 在 `.agents/skills/` 下添加带 `layer` 字段的
          SKILL.md 后会出现在这里。
        </p>
      ) : (
        layers.map((group) => (
          <section key={group.layer}>
            <h2 className="text-muted-foreground mb-2 px-1 text-xs font-medium">
              {group.label}
            </h2>
            <ul className="divide-border border-t">
              {group.skills.map((skill) => (
                <li
                  key={skill.name}
                  className="group flex items-center gap-3 border-b py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">
                      {skill.name}
                    </span>
                    {skill.description ? (
                      <span className="text-muted-foreground block truncate text-xs">
                        {skill.description}
                      </span>
                    ) : null}
                  </span>
                  {skill.userInvocable ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() =>
                        askAgent(
                          `请使用技能「${skill.name}」完成下面这件事：（在此描述具体目标）。技能说明：${skill.description}`,
                          `easel:skill:${skill.name}`,
                        )
                      }
                    >
                      运行
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
