import {
  useActionMutation,
  useActionQuery,
  useChangeVersions,
} from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  IconAlertCircle,
  IconCheck,
  IconClock,
  IconExternalLink,
  IconPlayerPlay,
  IconReload,
  IconRosetteDiscountCheck,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
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

type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

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
  status: "succeeded" | "failed";
  url: string | null;
  error: string | null;
  publishedAt: string | null;
  createdAt: string;
  metrics: Record<string, unknown>;
};

type Capability = {
  platform: string;
  label: string;
  capabilities: { autoPublish: boolean; note: string };
};

export default function PublishRoute() {
  useSetPageTitle("发布");
  // 调度器/worker 每次状态变更都会广播 publish 源; agent 入队走 action 源。
  // useDbSync 框架同步已全局生效 (见 real-time-sync), 这里用 5s 轻量轮询
  // 兼底: 队列状态对用户是高价值实时信息。
  const version = useChangeVersions(["publish", "action"]);
  void version;
  const [statusFilter, setStatusFilter] = useState<"queue" | "failed" | "all">(
    "queue",
  );

  const jobsQuery = useActionQuery("publish-status", {}, { enabled: true, refetchInterval: 5_000, refetchIntervalInBackground: false });
  const recordsQuery = useActionQuery("publish-records", { limit: 30 });
  const capsQuery = useActionQuery("publish-capabilities", {});

  const cancel = useActionMutation("publish-cancel");
  const retry = useActionMutation("publish-retry");

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
            {capabilities.map((cap) => (
              <div
                key={cap.platform}
                className="border-border flex items-start gap-2 rounded-lg border p-2.5"
                title={cap.capabilities.note}
              >
                {cap.capabilities.autoPublish ? (
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
                  <div className="font-medium">{cap.label}</div>
                  <div className="text-muted-foreground line-clamp-2 text-xs">
                    {cap.capabilities.autoPublish
                      ? "已接入, 可自动发布"
                      : "暂不支持自动发布 — 需人工发布"}
                  </div>
                </div>
              </div>
            ))}
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
                    {record.status === "failed" && record.error ? (
                      <p className="text-destructive mt-0.5 line-clamp-2 text-xs">
                        {record.error}
                      </p>
                    ) : null}
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {timestampLabel(record.publishedAt ?? record.createdAt)}
                      {" · "}
                      {record.status === "succeeded" ? "发布成功" : "发布失败"}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="text-muted-foreground mt-4 text-xs">
            归因数据（浏览/互动等）将在 Phase 3 回流到发布记录的 metrics 字段。
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
