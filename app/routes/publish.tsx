import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { subscribeSyncEvents } from "@agent-native/core/client/use-db-sync";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  IconAlertCircle,
  IconCheck,
  IconClipboardText,
  IconClock,
  IconExternalLink,
  IconPlayerPlay,
  IconReload,
  IconRosetteDiscountCheck,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_TITLE } from "@/lib/app-config";
import { askAgent, timestampLabel } from "@/lib/easel";

export function meta() {
  return [{ title: `发布 — ${APP_TITLE}` }];
}

type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** 平台接入模式展示名 (能力卡用). */
const MODE_LABELS: Record<string, string> = {
  api: "API 自动发布",
  assisted: "辅助发布",
  manual: "仅人工",
};

const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; variant: "secondary" | "outline" | "destructive" | "default" }
> = {
  pending: { label: "待发", variant: "secondary" },
  running: { label: "发布中", variant: "default" },
  succeeded: { label: "已发布", variant: "outline" },
  failed: { label: "失败", variant: "destructive" },
  cancelled: { label: "已取消", variant: "outline" },
};

const PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "B站",
  weibo: "微博",
  zhihu: "知乎",
  "wechat-oa": "公众号",
  "wechat-channels": "视频号",
};

type PublishJob = {
  id: string;
  topic: string;
  contentPath: string;
  platform: string;
  title: string;
  scheduledAt: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
};

type PublishRecord = {
  id: string;
  jobId: string | null;
  topic: string;
  platform: string;
  title: string;
  status: "succeeded" | "failed" | "manual_assisted";
  url: string | null;
  error: string | null;
  publishedAt: string | null;
  createdAt: string;
  metrics: {
    assisted?: {
      webEntry?: string;
      copyText?: string;
      title?: string;
      message?: string;
      mediaPaths?: string[];
    } | null;
  };
};

type Capability = {
  platform: string;
  label: string;
  capabilities: {
    autoPublish: boolean;
    note: string;
    mode?: "api" | "assisted" | "manual";
    webEntry?: string;
  };
};

/** SSE 通知事件形状 (worker notifyPublishOutcome → recordChange notify 字段). */
type PublishNotifyEvent = {
  notify?: {
    status?: "succeeded" | "failed" | "assisted";
    title?: string;
    platformLabel?: string;
    url?: string | null;
    error?: string | null;
    retryable?: boolean;
    summary?: string;
  };
};

export default function PublishRoute() {
  useSetPageTitle("发布");
  // 队列状态对用户是高价值实时信息: 5s 轻量轮询兼底 + SSE 通知即时刷新 (下Effect)。
  const [statusFilter, setStatusFilter] = useState<"queue" | "failed" | "all">(
    "queue",
  );

  const jobsQuery = useActionQuery("publish-status", {}, { enabled: true, refetchInterval: 5_000, refetchIntervalInBackground: false });
  const recordsQuery = useActionQuery("publish-records", { limit: 30 });
  const capsQuery = useActionQuery("publish-capabilities", {});

  const cancel = useActionMutation("publish-cancel");
  const retry = useActionMutation("publish-retry");

  // ── 发布终态通知: 订阅共享 SSE 通道 (real-time-sync 技能背书路径)。
  // worker 在任务进入 succeeded/failed/assisted 终态时 recordChange 推
  // notify payload; 这里弹结构化 toast + 失败一键重试。同任务去重。
  const notifiedJobIds = useRef<Set<string>>(new Set());
  const retryRef = useRef(retry);
  retryRef.current = retry;
  useEffect(() => {
    return subscribeSyncEvents({
      onEvents: (events) => {
        for (const event of events) {
          if (event.source !== "publish" || event.type !== "job-finished") continue;
          const notify = (event as PublishNotifyEvent).notify;
          if (!notify || !event.key || notifiedJobIds.current.has(event.key)) continue;
          notifiedJobIds.current.add(event.key);
          void jobsQuery.refetch();
          void recordsQuery.refetch();
          if (notify.status === "failed") {
            toast.error(notify.summary ?? "发布任务失败", {
              description: notify.retryable
                ? "失败原因已记录在任务行, 可一键重试 (瞬时错误会自动退避重排)"
                : "失败原因已记录在任务行 — 凭据/配置类问题请修复后重试",
              action: {
                label: "重试",
                onClick: () => {
                  retryRef.current.mutate(
                    { id: event.key! },
                    {
                      onSuccess: () => toast.success("已重新入队"),
                      onError: (error) => toast.error(error.message),
                    },
                  );
                },
              },
            });
          } else if (notify.status === "assisted") {
            toast.info(
              notify.summary ?? "辅助发布包已生成",
              {
                description:
                  "到下方发布记录复制内容包, 打开平台网页粘贴发布 — 该平台无发布 API, 人工粘贴是唯一通道",
              },
            );
          } else {
            toast.success(notify.summary ?? "发布成功");
          }
        }
      },
    });
  }, [jobsQuery, recordsQuery]);

  const jobs = (jobsQuery.data?.jobs ?? []) as PublishJob[];
  const records = (recordsQuery.data?.records ?? []) as PublishRecord[];
  const capabilities = (capsQuery.data?.platforms ?? []) as Capability[];

  const counts = jobsQuery.data?.counts ?? {};
  const pendingCount = (counts.pending ?? 0) + (counts.running ?? 0);
  const failedCount = counts.failed ?? 0;

  const filtered = jobs.filter((job) => {
    if (statusFilter === "queue") return job.status === "pending" || job.status === "running";
    if (statusFilter === "failed") return job.status === "failed" || job.status === "cancelled";
    return true;
  });

  const busy = cancel.isPending || retry.isPending;

  function onCancel(job: PublishJob) {
    cancel.mutate(
      { id: job.id },
      {
        onSuccess: () => toast.success("已取消发布任务"),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function onRetry(job: PublishJob) {
    retry.mutate(
      { id: job.id },
      {
        onSuccess: () => toast.success("已重新入队"),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() =>
            askAgent(
              "读取内容库中 status=ready 的项目与激活画像的平台列表，用 publish-checklist 技能逐项检查后，把检查通过的成品用 publish-queue 排入发布队列（立即执行），并把队列状态反馈给我。",
              "easel:publish-ready",
            )
          }
        >
          <IconSend className="size-4" strokeWidth={1.8} />
          发布待发内容
        </Button>
        <Button variant="outline" asChild>
          <Link to="/quality">先跑质检</Link>
        </Button>
        <div className="ml-auto flex gap-1">
          {(
            [
              { key: "queue", label: `队列 ${pendingCount}` },
              { key: "failed", label: `失败/取消 ${failedCount}` },
              { key: "all", label: `全部 ${jobs.length}` },
            ] as const
          ).map((filter) => (
            <Button
              key={filter.key}
              size="sm"
              variant={statusFilter === filter.key ? "secondary" : "ghost"}
              onClick={() => setStatusFilter(filter.key)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      {/* 平台能力声明 — 如实展示, 未接入平台给人工路径 */}
      {capsQuery.data ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">平台自动发布能力</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((cap) => {
              const mode = cap.capabilities.mode ?? "manual";
              return (
                <div
                  key={cap.platform}
                  className="border-border flex items-start gap-2 rounded-lg border p-2.5"
                  title={cap.capabilities.note}
                >
                  {mode === "api" ? (
                    <IconRosetteDiscountCheck
                      className="text-success mt-0.5 size-4 shrink-0"
                      strokeWidth={1.8}
                    />
                  ) : (
                    <IconAlertCircle
                      className="text-muted-foreground mt-0.5 size-4 shrink-0"
                      strokeWidth={1.8}
                    />
                  )}
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">
                      {cap.label}
                      <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                        {MODE_LABELS[mode] ?? mode}
                      </span>
                    </div>
                    <div className="text-muted-foreground line-clamp-2 text-xs">
                      {mode === "api"
                        ? "已接入, 可自动发布"
                        : mode === "assisted"
                          ? "队列产出复制包, 粘贴发布"
                          : "暂不支持自动发布 — 需人工发布"}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* 队列看板 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">发布队列</CardTitle>
        </CardHeader>
        <CardContent>
          {jobsQuery.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {statusFilter === "queue"
                ? "队列为空 — 在对话里完成创作并过质检后, 让 Agent 帮你入队。"
                : "这里空空的。"}
            </p>
          ) : (
            <ul className="divide-border border-t">
              {filtered.map((job) => (
                <li
                  key={job.id}
                  className="flex items-center gap-3 border-b py-2.5 text-sm"
                >
                  <JobStatusIcon status={job.status} />
                  <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">
                    {timestampLabel(job.scheduledAt)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{job.title || job.topic}</span>
                    {job.lastError ? (
                      <span className="text-destructive block truncate text-xs">
                        {job.lastError}
                      </span>
                    ) : null}
                  </span>
                  <Badge variant="outline" className="text-muted-foreground shrink-0">
                    {PLATFORM_LABELS[job.platform] ?? job.platform}
                  </Badge>
                  <Badge
                    variant={JOB_STATUS_META[job.status]?.variant ?? "outline"}
                    className="shrink-0"
                  >
                    {JOB_STATUS_META[job.status]?.label ?? job.status}
                    {job.status === "pending" && job.attempts > 0
                      ? ` · 第 ${job.attempts + 1} 次`
                      : ""}
                  </Badge>
                  <span className="w-16 shrink-0 text-right">
                    {job.status === "pending" || job.status === "cancelled" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label="取消发布任务"
                        className="text-muted-foreground hover:text-destructive h-7 px-2"
                        onClick={() => onCancel(job)}
                      >
                        <IconX className="size-3.5" strokeWidth={1.8} />
                        取消
                      </Button>
                    ) : job.status === "failed" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label="重试发布任务"
                        title={
                          job.lastError
                            ? `失败原因: ${job.lastError.slice(0, 120)} — 点击重新入队`
                            : "重新入队, 立即执行"
                        }
                        className="text-muted-foreground hover:text-foreground h-7 px-2"
                        onClick={() => onRetry(job)}
                      >
                        <IconReload className="size-3.5" strokeWidth={1.8} />
                        重试
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 发布记录时间线 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">发布记录</CardTitle>
        </CardHeader>
        <CardContent>
          {recordsQuery.isPending ? (
            <Skeleton className="h-20" />
          ) : records.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              还没有发布留痕。每次发布成功或最终失败都会记录在这里。
            </p>
          ) : (
            <ol className="border-border relative space-y-4 border-t pt-4 before:absolute before:top-4 before:bottom-4 before:left-[7px] before:w-px before:bg-border">
              {records.map((record) => (
                <li key={record.id} className="relative flex gap-4 pl-6">
                  <span
                    className={`border-background absolute left-0 top-1 size-[15px] rounded-full border-2 ${
                      record.status === "succeeded"
                        ? "bg-emerald-500"
                        : record.status === "manual_assisted"
                          ? "bg-amber-500"
                          : "bg-destructive"
                    }`}
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate font-medium">
                        {record.title || record.topic}
                      </span>
                      <Badge variant="outline" className="text-muted-foreground">
                        {PLATFORM_LABELS[record.platform] ?? record.platform}
                      </Badge>
                      {record.status === "manual_assisted" ? (
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 text-amber-900"
                        >
                          待粘贴发布
                        </Badge>
                      ) : null}
                      {record.url ? (
                        <a
                          href={record.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs"
                        >
                          查看发布 <IconExternalLink className="size-3" strokeWidth={1.8} />
                        </a>
                      ) : null}
                    </div>
                    {record.status === "manual_assisted" ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => {
                            const pack = record.metrics?.assisted;
                            const text = pack?.copyText ?? record.title;
                            void navigator.clipboard
                              .writeText(text)
                              .then(() => toast.success("复制包已复制 — 到平台网页粘贴发布"))
                              .catch(() => toast.error("复制失败, 请手动选择文本复制"));
                          }}
                        >
                          <IconClipboardText className="size-3.5" strokeWidth={1.8} />
                          复制发布包
                        </Button>
                        {record.metrics?.assisted?.webEntry ? (
                          <a
                            href={record.metrics.assisted.webEntry}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs"
                          >
                            打开{PLATFORM_LABELS[record.platform] ?? "平台"}发布页{" "}
                            <IconExternalLink className="size-3" strokeWidth={1.8} />
                          </a>
                        ) : null}
                        {record.metrics?.assisted?.mediaPaths?.length ? (
                          <span className="text-muted-foreground text-xs">
                            需手动上传 {record.metrics.assisted.mediaPaths.length} 个媒体文件
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {record.status === "failed" && record.error ? (
                      <p className="text-destructive mt-0.5 line-clamp-2 text-xs">
                        {record.error}
                      </p>
                    ) : null}
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {timestampLabel(record.publishedAt ?? record.createdAt)}
                      {" · "}
                      {record.status === "succeeded"
                        ? "发布成功"
                        : record.status === "manual_assisted"
                          ? "辅助发布包已交付, 待人工粘贴"
                          : "发布失败"}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="text-muted-foreground mt-4 text-xs">
            互动数据（浏览/点赞等）由用户从平台后台手动录入到发布记录，发布成功后到{" "}
            <Link to="/metrics" className="hover:text-foreground underline underline-offset-2">
              归因页
            </Link>{" "}
            补录，dashboard 效果图表才会包含这条内容。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function JobStatusIcon({ status }: { status: JobStatus }) {
  if (status === "succeeded") {
    return <IconCheck className="text-success size-4 shrink-0" strokeWidth={1.8} />;
  }
  if (status === "failed") {
    return <IconAlertCircle className="text-destructive size-4 shrink-0" strokeWidth={1.8} />;
  }
  if (status === "running") {
    return <IconPlayerPlay className="size-4 shrink-0" strokeWidth={1.8} />;
  }
  if (status === "cancelled") {
    return <IconX className="text-muted-foreground size-4 shrink-0" strokeWidth={1.8} />;
  }
  return <IconClock className="text-muted-foreground size-4 shrink-0" strokeWidth={1.8} />;
}
