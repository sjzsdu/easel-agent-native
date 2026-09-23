import { useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { askAgent, timestampLabel } from "@/lib/easel";

export function meta() {
  return [{ title: `热点 — ${APP_TITLE}` }];
}

const PLATFORM_FILTERS = [
  { key: "all", label: "全部" },
  { key: "weibo", label: "微博" },
  { key: "douyin", label: "抖音" },
  { key: "zhihu", label: "知乎" },
  { key: "bili", label: "B站" },
  { key: "baidu", label: "百度" },
  { key: "toutiao", label: "头条" },
];

export default function TrendsRoute() {
  useSetPageTitle("热点");
  const [platform, setPlatform] = useState("all");
  const query = useActionQuery("trends", {});

  const results = (query.data?.results ?? []).filter(
    (result) => platform === "all" || result.platform === platform,
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() =>
            askAgent(
              "调用热点雷达，结合当前激活画像的定位，从全部热榜里挑出 3 条最适合我蹭的热点，给出切入角度；有合适的直接转成选题存入选题库。",
              "easel:discover",
            )
          }
        >
          结合画像筛选今日可蹭热点
        </Button>

        <div className="flex flex-wrap gap-1">
          {PLATFORM_FILTERS.map((filter) => (
            <Button
              key={filter.key}
              size="sm"
              variant={platform === filter.key ? "secondary" : "ghost"}
              onClick={() => setPlatform(filter.key)}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        <div className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
          {query.data ? <span>{timestampLabel(query.data.fetchedAt)}</span> : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                aria-label="刷新热榜"
                onClick={() => void query.refetch()}
              >
                <IconRefresh
                  className={query.isFetching ? "size-4 animate-spin" : "size-4"}
                  strokeWidth={1.8}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新热榜</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {query.isPending ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-5 w-24" />
              {Array.from({ length: 5 }).map((__, j) => (
                <Skeleton key={j} className="h-9" />
              ))}
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <div className="text-muted-foreground space-y-3 text-sm">
          <p>热点数据获取失败。</p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            重试
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {results.map((result) => (
            <section key={result.platform}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold">{result.label}</h2>
                {result.error ? (
                  <span className="text-warning text-xs">{result.error}</span>
                ) : null}
              </div>
              {result.items.length === 0 ? (
                <p className="text-muted-foreground text-sm">暂无数据。</p>
              ) : (
                <ul className="divide-border border-t">
                  {result.items.map((item) => (
                    <li
                      key={item.rank}
                      className="group flex items-center gap-3 border-b py-2 text-sm"
                    >
                      <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">
                        {item.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground inline-flex max-w-full items-center gap-1"
                          >
                            <span className="truncate">{item.title}</span>
                            <IconExternalLink
                              className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                              strokeWidth={1.8}
                            />
                          </a>
                        ) : (
                          item.title
                        )}
                      </span>
                      {item.hot !== undefined ? (
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {typeof item.hot === "number"
                            ? item.hot.toLocaleString()
                            : item.hot}
                        </span>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() =>
                          askAgent(
                            `把这条热点转成选题存入选题库：「${item.title}」（${result.label}热榜第 ${item.rank}${item.url ? `，链接 ${item.url}` : ""}）。结合当前激活画像给出切入点和备注。`,
                            "easel:idea-from-trend",
                          )
                        }
                      >
                        转选题
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {results.length === 0 ? (
            <p className="text-muted-foreground text-sm">该平台暂无数据。</p>
          ) : null}
        </div>
      )}

      {query.data ? (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="text-muted-foreground text-xs">数据源：</span>
          {query.data.results
            .filter((r) => r.source)
            .map((r) => (
              <Badge key={r.platform} variant="outline" className="text-muted-foreground">
                {r.label} · {r.source === "cache" ? "缓存" : r.source}
              </Badge>
            ))}
        </div>
      ) : null}
    </div>
  );
}
