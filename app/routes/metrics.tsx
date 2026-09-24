import {
  useActionMutation,
  useActionQuery,
  useChangeVersions,
} from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  IconAlertTriangle,
  IconChartBar,
  IconClipboardText,
  IconExternalLink,
  IconPencil,
  IconRefresh,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_TITLE } from "@/lib/app-config";
import { askAgent, dayLabel, timestampLabel } from "@/lib/easel";

export function meta() {
  return [{ title: `归因 — ${APP_TITLE}` }];
}

const PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "B站",
  weibo: "微博",
  zhihu: "知乎",
  "wechat-oa": "公众号",
  "wechat-channels": "视频号",
};

const METRIC_FIELDS = [
  { key: "views", label: "播放/浏览" },
  { key: "likes", label: "点赞" },
  { key: "collects", label: "收藏" },
  { key: "comments", label: "评论" },
  { key: "shares", label: "转发/分享" },
  { key: "followersGained", label: "粉丝变化" },
] as const;

type MetricsEntry = {
  recordId: string;
  topic: string;
  title: string;
  platform: string;
  publishedAt: string | null;
  url: string | null;
  metrics: Record<string, number> | null;
  engagementTotal: number | null;
  collectedAt: string | null;
  hasMetrics: boolean;
};

type Trends = {
  coverage: {
    publishedSucceeded: number;
    withMetrics: number;
    missingMetrics: number;
    coveragePct: number;
    note?: string;
  };
  trend: { date: string; interactions: number; published: number }[];
  platformComparison: {
    platform: string;
    label: string;
    records: number;
    interactions: number;
    avgScore: number;
  }[];
  top: {
    rank: number;
    recordId: string;
    title: string;
    topic: string;
    label: string;
    publishedAt: string;
    interactions: number;
  }[];
  weekdayPattern: { label: string; records: number; avgEngagement: number | null }[];
};

export default function MetricsRoute() {
  useSetPageTitle("归因");
  // worker/录入路径都会广播 action 源; version 变化触发 hooks 重取。
  const version = useChangeVersions(["action"]);
  void version;

  const entriesQuery = useActionQuery("metrics", { limit: 100 });
  const trendsQuery = useActionQuery("metrics-trends", {});
  const save = useActionMutation("metrics-save");

  const entries = (entriesQuery.data?.entries ?? []) as MetricsEntry[];
  const trends = trendsQuery.data as Trends | undefined;

  const [recordId, setRecordId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const selected = entries.find((e) => e.recordId === recordId);
  const missing = entries.filter((e) => !e.hasMetrics);

  function onSave() {
    if (!selected) return;
    const metrics: Record<string, number> = {};
    for (const field of METRIC_FIELDS) {
      const raw = values[field.key]?.trim();
      if (raw) metrics[field.key] = Number(raw);
    }
    if (Object.keys(metrics).length === 0) {
      toast.error("至少填写一项指标");
      return;
    }
    save.mutate(
      { metrics, publishRecordId: selected.recordId },
      {
        onSuccess: () => {
          toast.success("已录入 — 数据可在图表中看到");
          setValues({});
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const maxTrend = useMemo(
    () => Math.max(1, ...(trends?.trend ?? []).map((t) => t.interactions)),
    [trends],
  );
  const maxPlatform = useMemo(
    () => Math.max(1, ...(trends?.platformComparison ?? []).map((p) => p.interactions)),
    [trends],
  );
  const maxWeekday = useMemo(
    () => Math.max(1, ...(trends?.weekdayPattern ?? []).map((w) => w.avgEngagement ?? 0)),
    [trends],
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
      {/* 数据来源诚实声明 */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <IconClipboardText className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
        <p className="min-w-0">
          互动数据来自<strong>手动录入</strong>（从平台后台复制数字），平台 API 自动回流尚未接入。
          图表只统计录入过的数据，缺失不补零 — 数据覆盖度见下方。
        </p>
      </div>

      {/* 覆盖度概览 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="已发布（成功）" value={trends?.coverage.publishedSucceeded} loading={trendsQuery.isPending} />
        <Stat label="已录入数据" value={trends?.coverage.withMetrics} loading={trendsQuery.isPending} />
        <Stat label="待录入" value={trends?.coverage.missingMetrics} loading={trendsQuery.isPending} />
        <Stat label="覆盖度" value={trends ? `${trends.coverage.coveragePct}%` : undefined} loading={trendsQuery.isPending} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 引导式录入 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPencil className="size-4" strokeWidth={1.8} />
              录入互动数据
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {entriesQuery.isPending ? (
              <Skeleton className="h-32" />
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                还没有成功的发布留痕 — 先通过对话完成创作与发布，发布成功后才能录入效果数据。
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="metrics-record">选择已发布内容（{missing.length} 条待录入）</Label>
                  <select
                    id="metrics-record"
                    value={recordId}
                    onChange={(e) => {
                      setRecordId(e.target.value);
                      setValues({});
                    }}
                    className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
                  >
                    <option value="">— 选择发布记录 —</option>
                    {entries.map((entry) => (
                      <option key={entry.recordId} value={entry.recordId}>
                        [{entry.hasMetrics ? "已有数据" : "待录入"}] {entry.title || entry.topic} ·{" "}
                        {PLATFORM_LABELS[entry.platform] ?? entry.platform}
                      </option>
                    ))}
                  </select>
                </div>
                {selected ? (
                  <>                    <div className="text-muted-foreground text-xs">
                      发布于 {dayLabel((selected.publishedAt ?? "").slice(0, 10))} {" "}
                      {timestampLabel(selected.publishedAt ?? undefined)}
                      {selected.hasMetrics && selected.collectedAt
                        ? ` · 上次录入 ${timestampLabel(selected.collectedAt)}`
                        : ""}
                      {selected.url ? (
                        <a
                          href={selected.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground ml-1 inline-flex items-center gap-0.5"
                        >
                          打开平台页 <IconExternalLink className="size-3" strokeWidth={1.8} />
                        </a>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {METRIC_FIELDS.map((field) => (
                        <div key={field.key} className="space-y-1">
                          <Label htmlFor={`m-${field.key}`} className="text-xs">
                            {field.label}
                          </Label>
                          <Input
                            id={`m-${field.key}`}
                            inputMode="numeric"
                            placeholder="数字"
                            value={values[field.key] ?? ""}
                            onChange={(e) =>
                              setValues((v) => ({ ...v, [field.key]: e.target.value }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={onSave} disabled={save.isPending}>
                        {save.isPending ? "保存中…" : "保存"}
                      </Button>
                      <span className="text-muted-foreground text-xs">
                        只录入平台后台看到的真实数字，可分批补录
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    选择一条记录后填写数字。也可以直接在对话里说「把昨天小红书那条的数据录进去：点赞 320、收藏 85…」让 Agent 代录。
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* 平台对比 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconChartBar className="size-4" strokeWidth={1.8} />
              平台互动对比
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trendsQuery.isPending ? (
              <Skeleton className="h-40" />
            ) : !trends || trends.platformComparison.length === 0 ? (
              <p className="text-muted-foreground text-sm">还没有已录入数据的发布记录。</p>
            ) : (
              <ul className="space-y-2.5">
                {trends.platformComparison.map((p) => (
                  <li key={p.platform} className="text-sm">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span>
                        {p.label}
                        <span className="text-muted-foreground ml-1.5 text-xs">
                          {p.records} 条 · 均分 {p.avgScore}
                        </span>
                      </span>
                      <span className="tabular-nums">{p.interactions}</span>
                    </div>
                    <BarGraph
                      values={[p.interactions]}
                      max={maxPlatform}
                      colors={["bg-primary/70"]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 近 30 天趋势 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">近 30 天互动趋势</CardTitle>
          </CardHeader>
          <CardContent>
            {trendsQuery.isPending ? (
              <Skeleton className="h-32" />
            ) : !trends || trends.trend.length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无数据。</p>
            ) : (
              <>
                <BarGraph
                  values={trends.trend.map((t) => t.interactions)}
                  max={maxTrend}
                  colors={[]}
                  className="h-28"
                />
                <div className="text-muted-foreground mt-1.5 flex justify-between text-xs tabular-nums">
                  <span>{dayLabel(trends.trend[0]!.date)}</span>
                  <span>峰值 {maxTrend}</span>
                  <span>{dayLabel(trends.trend[trends.trend.length - 1]!.date)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 星期规律 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">发布星期规律</CardTitle>
          </CardHeader>
          <CardContent>
            {trendsQuery.isPending ? (
              <Skeleton className="h-32" />
            ) : !trends ? (
              <p className="text-muted-foreground text-sm">暂无数据。</p>
            ) : (
              <>
                <BarGraph
                  values={trends.weekdayPattern.map((w) => w.avgEngagement ?? 0)}
                  max={maxWeekday}
                  colors={[]}
                  className="h-24"
                />
                <div className="text-muted-foreground mt-1.5 grid grid-cols-7 text-center text-xs">
                  {trends.weekdayPattern.map((w) => (
                    <span key={w.label} title={w.records ? `${w.records} 条样本` : "无样本"}>
                      {w.label.replace("周", "")}
                    </span>
                  ))}
                </div>
                {trends.coverage.note ? (
                  <p className="mt-2 flex items-start gap-1 text-xs text-amber-700">
                    <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} />
                    {trends.coverage.note}
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* TOP 内容 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">TOP 内容（按互动分）</CardTitle>
        </CardHeader>
        <CardContent>
          {trendsQuery.isPending ? (
            <Skeleton className="h-20" />
          ) : !trends || trends.top.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              还没有可排名的内容 — 录入互动数据后这里会列出表现最好的发布。
            </p>
          ) : (
            <ol className="divide-border border-t">
              {trends.top.map((item) => (
                <li key={item.recordId} className="border-b py-2.5 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground w-6 shrink-0 text-center tabular-nums">
                      {item.rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <Badge variant="outline" className="text-muted-foreground shrink-0">
                      {item.label}
                    </Badge>
                    <span className="w-16 shrink-0 text-right tabular-nums">
                      {item.interactions}
                    </span>
                  </div>
                  <span className="text-muted-foreground mt-0.5 block pl-9 text-xs tabular-nums">
                    {timestampLabel(item.publishedAt)} 发布
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* 归因洞察 — 交给 agent, 用户一句话触发 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">归因洞察</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            让 Agent 交叉分析互动数据 × 日历排期 × 内容库，回答「什么选题 / 标题 / 时段效果好」。
          </p>
          <Button
            variant="outline"
            onClick={() =>
              askAgent(
                "基于已录入的互动数据跑一遍归因分析：先用 metrics 检查数据覆盖度（缺的列出来提醒我补录），然后用 metrics-insights 交叉分析出「哪类选题/标题/发布时段效果好」的结构化结论，最后结合内容库给出下一步 3 条可执行建议。",
                "easel:metrics-insights",
              )
            }
          >
            <IconRefresh className="size-4" strokeWidth={1.8} />
            生成归因洞察
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | string | undefined;
  loading?: boolean;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      {loading || value === undefined ? (
        <Skeleton className="mt-1 h-6 w-12" />
      ) : (
        <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      )}
    </div>
  );
}

/** 纯 div 手绘条形图 (无图表依赖): values 均分宽度, 相对 max 取高。 */
function BarGraph({
  values,
  max,
  colors,
  className = "",
}: {
  values: number[];
  max: number;
  colors: string[];
  className?: string;
}) {
  return (
    <div className={`flex items-end gap-[3px] ${className || "h-8"}`} aria-hidden>
      {values.map((v, i) => (
        <div
          key={i}
          className={`${colors[i % colors.length] || "bg-primary/60"} min-h-[2px] flex-1 rounded-sm`}
          style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
