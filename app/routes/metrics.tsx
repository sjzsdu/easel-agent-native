import {
  useActionMutation,
  useActionQuery,
  useChangeVersions,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  IconAlertTriangle,
  IconChartBar,
  IconClipboardText,
  IconExternalLink,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconX,
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
import { askAgent, timestampLabel, useDayLabel, useWeekdayNames } from "@/lib/easel";

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
  { key: "views", labelKey: "easel.metrics.fieldViews" },
  { key: "likes", labelKey: "easel.metrics.fieldLikes" },
  { key: "collects", labelKey: "easel.metrics.fieldCollects" },
  { key: "comments", labelKey: "easel.metrics.fieldComments" },
  { key: "shares", labelKey: "easel.metrics.fieldShares" },
  { key: "followersGained", labelKey: "easel.metrics.fieldFollowers" },
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
    platform: string;
    label: string;
    publishedAt: string;
    interactions: number;
  }[];
  weekdayPattern: { weekday: number; label: string; records: number; avgEngagement: number | null }[];
};

export default function MetricsRoute() {
  const t = useT();
  const dayLabel = useDayLabel();
  const weekdayNames = useWeekdayNames();
  useSetPageTitle(t("easel.nav.metrics"));
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
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTopic, setManualTopic] = useState("");
  const [manualPlatform, setManualPlatform] = useState("xiaohongshu");
  const [manualValues, setManualValues] = useState<Record<string, string>>({});

  const selected = entries.find((e) => e.recordId === recordId);
  const missing = entries.filter((e) => !e.hasMetrics);

  function collectMetrics(source: Record<string, string>): Record<string, number> | null {
    const metrics: Record<string, number> = {};
    for (const field of METRIC_FIELDS) {
      const raw = source[field.key]?.trim();
      if (raw) metrics[field.key] = Number(raw);
    }
    if (Object.keys(metrics).length === 0) {
      toast.error(t("easel.metrics.toastNeedField"));
      return null;
    }
    return metrics;
  }

  function onSave() {
    if (!selected) return;
    const metrics = collectMetrics(values);
    if (!metrics) return;
    save.mutate(
      { metrics, publishRecordId: selected.recordId },
      {
        onSuccess: () => {
          toast.success(t("easel.metrics.toastSaved"));
          setValues({});
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function onManualSave() {
    const topic = manualTopic.trim();
    if (!topic) {
      toast.error("请填写内容标题");
      return;
    }
    const metrics = collectMetrics(manualValues);
    if (!metrics) return;
    save.mutate(
      { metrics, manualEntry: true, topic, platform: manualPlatform },
      {
        onSuccess: () => {
          toast.success("手动数据已录入（来源标注为 manual）");
          setManualTopic("");
          setManualValues({});
          setManualOpen(false);
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
          {t("easel.metrics.manualNoticePrefix")}<strong>{t("easel.metrics.manualNoticeStrong")}</strong>{t("easel.metrics.manualNoticeMiddle")}
          {t("easel.metrics.manualNoticeSuffix")}
        </p>
      </div>

      {/* 覆盖度概览 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("easel.metrics.statPublished")} value={trends?.coverage.publishedSucceeded} loading={trendsQuery.isPending} />
        <Stat label={t("easel.metrics.statEntered")} value={trends?.coverage.withMetrics} loading={trendsQuery.isPending} />
        <Stat label={t("easel.metrics.statMissing")} value={trends?.coverage.missingMetrics} loading={trendsQuery.isPending} />
        <Stat label={t("easel.metrics.statCoverage")} value={trends ? `${trends.coverage.coveragePct}%` : undefined} loading={trendsQuery.isPending} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 引导式录入 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPencil className="size-4" strokeWidth={1.8} />
              {t("easel.metrics.enterTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                有发布留痕的内容在下方选择录入；没走发布链路的内容（手动发布/旧内容）用「手动录入」。
              </p>
              <Button
                size="sm"
                variant={manualOpen ? "secondary" : "outline"}
                onClick={() => setManualOpen((v) => !v)}
              >
                {manualOpen ? <IconX className="size-4" strokeWidth={1.8} /> : <IconPlus className="size-4" strokeWidth={1.8} />}
                手动录入
              </Button>
            </div>
            {manualOpen ? (
              <div className="border-border space-y-3 rounded-md border border-dashed p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="manual-topic" className="text-xs">
                      内容标题（必填）
                    </Label>
                    <Input
                      id="manual-topic"
                      value={manualTopic}
                      placeholder="如：3 月第 4 篇笔记"
                      onChange={(e) => setManualTopic(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="manual-platform" className="text-xs">
                      平台
                    </Label>
                    <select
                      id="manual-platform"
                      value={manualPlatform}
                      onChange={(e) => setManualPlatform(e.target.value)}
                      className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
                    >
                      {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {METRIC_FIELDS.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <Label htmlFor={`manual-${field.key}`} className="text-xs">
                        {t(field.labelKey)}
                      </Label>
                      <Input
                        id={`manual-${field.key}`}
                        inputMode="numeric"
                        placeholder={t("easel.metrics.numberPlaceholder")}
                        value={manualValues[field.key] ?? ""}
                        onChange={(e) =>
                          setManualValues((v) => ({ ...v, [field.key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={onManualSave} disabled={save.isPending}>
                    {save.isPending ? "保存中…" : "保存手动数据"}
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    不依赖发布记录，数据会以 manual 来源进入趋势与洞察
                  </span>
                </div>
              </div>
            ) : null}
            {entriesQuery.isPending ? (
              <Skeleton className="h-32" />
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("easel.metrics.noRecords")}
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="metrics-record">{t("easel.metrics.selectLabel", { count: missing.length })}</Label>
                  <select
                    id="metrics-record"
                    value={recordId}
                    onChange={(e) => {
                      setRecordId(e.target.value);
                      setValues({});
                    }}
                    className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
                  >
                    <option value="">{t("easel.metrics.selectPlaceholder")}</option>
                    {entries.map((entry) => (
                      <option key={entry.recordId} value={entry.recordId}>
                        [{entry.hasMetrics ? t("easel.metrics.tagHasData") : t("easel.metrics.tagToEnter")}] {entry.title || entry.topic} ·{" "}
                        {t(`easel.platform.${entry.platform}`, { defaultValue: entry.platform })}
                      </option>
                    ))}
                  </select>
                </div>
                {selected ? (
                  <>                    <div className="text-muted-foreground text-xs">
                      {t("easel.metrics.publishedAt", { date: dayLabel((selected.publishedAt ?? "").slice(0, 10)) })}{" "}
                      {timestampLabel(selected.publishedAt ?? undefined)}
                      {selected.hasMetrics && selected.collectedAt
                        ? ` ${t("easel.metrics.lastEntered", { time: timestampLabel(selected.collectedAt) })}`
                        : ""}
                      {selected.url ? (
                        <a
                          href={selected.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground ml-1 inline-flex items-center gap-0.5"
                        >
                          {t("easel.metrics.openPlatform")} <IconExternalLink className="size-3" strokeWidth={1.8} />
                        </a>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {METRIC_FIELDS.map((field) => (
                        <div key={field.key} className="space-y-1">
                          <Label htmlFor={`m-${field.key}`} className="text-xs">
                            {t(field.labelKey)}
                          </Label>
                          <Input
                            id={`m-${field.key}`}
                            inputMode="numeric"
                            placeholder={t("easel.metrics.numberPlaceholder")}
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
                        {save.isPending ? t("easel.common.saving") : t("easel.common.save")}
                      </Button>
                      <span className="text-muted-foreground text-xs">
                        {t("easel.metrics.saveHint")}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {t("easel.metrics.selectHint")}
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
              {t("easel.metrics.platformCompareTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trendsQuery.isPending ? (
              <Skeleton className="h-40" />
            ) : !trends || trends.platformComparison.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("easel.metrics.platformEmpty")}</p>
            ) : (
              <ul className="space-y-2.5">
                {trends.platformComparison.map((p) => (
                  <li key={p.platform} className="text-sm">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span>
                        {t(`easel.platform.${p.platform}`, { defaultValue: p.label })}
                        <span className="text-muted-foreground ml-1.5 text-xs">
                          {t("easel.metrics.recordsUnit", { count: p.records, score: p.avgScore })}
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
            <CardTitle className="text-base">{t("easel.metrics.trendTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {trendsQuery.isPending ? (
              <Skeleton className="h-32" />
            ) : !trends || trends.trend.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("easel.common.noData")}</p>
            ) : (
              <>
                <BarGraph
                  values={trends.trend.map((item) => item.interactions)}
                  max={maxTrend}
                  colors={[]}
                  className="h-28"
                />
                <div className="text-muted-foreground mt-1.5 flex justify-between text-xs tabular-nums">
                  <span>{dayLabel(trends.trend[0]!.date)}</span>
                  <span>{t("easel.metrics.peak", { count: maxTrend })}</span>
                  <span>{dayLabel(trends.trend[trends.trend.length - 1]!.date)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 星期规律 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("easel.metrics.weekdayTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {trendsQuery.isPending ? (
              <Skeleton className="h-32" />
            ) : !trends ? (
              <p className="text-muted-foreground text-sm">{t("easel.common.noData")}</p>
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
                    <span
                      key={w.weekday}
                      title={w.records ? t("easel.metrics.sampleCount", { count: w.records }) : t("easel.metrics.noSample")}
                    >
                      {(weekdayNames[w.weekday] ?? w.label).replace(/^周/, "")}
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
          <CardTitle className="text-base">{t("easel.metrics.topTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {trendsQuery.isPending ? (
            <Skeleton className="h-20" />
          ) : !trends || trends.top.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("easel.metrics.topEmpty")}
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
                      {t(`easel.platform.${item.platform}`, { defaultValue: item.label })}
                    </Badge>
                    <span className="w-16 shrink-0 text-right tabular-nums">
                      {item.interactions}
                    </span>
                  </div>
                  <span className="text-muted-foreground mt-0.5 block pl-9 text-xs tabular-nums">
                    {timestampLabel(item.publishedAt)} {t("easel.metrics.publishedSuffix")}
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
          <CardTitle className="text-base">{t("easel.metrics.insightTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {t("easel.metrics.insightDesc")}
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
            {t("easel.metrics.insightCta")}
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
