import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { subscribeSyncEvents } from "@agent-native/core/client/use-db-sync";
import { useT } from "@agent-native/core/client/i18n";
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

/** 平台接入模式展示名 (能力卡用) — key 对应 easel.mode.* 消息. */
const MODE_KEYS: Record<string, string> = {
  api: "easel.mode.api",
  assisted: "easel.mode.assisted",
  manual: "easel.mode.manual",
  sau: "easel.mode.sau",
};

const JOB_STATUS_META: Record<
  JobStatus,
  { labelKey: string; variant: "secondary" | "outline" | "destructive" | "default" }
> = {
  pending: { labelKey: "easel.jobStatus.pending", variant: "secondary" },
  running: { labelKey: "easel.jobStatus.running", variant: "default" },
  succeeded: { labelKey: "easel.jobStatus.succeeded", variant: "outline" },
  failed: { labelKey: "easel.jobStatus.failed", variant: "destructive" },
  cancelled: { labelKey: "easel.jobStatus.cancelled", variant: "outline" },
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
    mode?: "api" | "assisted" | "manual" | "sau";
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
  const t = useT();
  useSetPageTitle(t("easel.nav.publish"));
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
            toast.error(notify.summary ?? t("easel.publish.toastJobFailed"), {
              description: notify.retryable
                ? t("easel.publish.toastRetryHint")
                : t("easel.publish.toastFixHint"),
              action: {
                label: t("easel.common.retry"),
                onClick: () => {
                  retryRef.current.mutate(
                    { id: event.key! },
                    {
                      onSuccess: () => toast.success(t("easel.publish.toastRequeued")),
                      onError: (error) => toast.error(error.message),
                    },
                  );
                },
              },
            });
          } else if (notify.status === "assisted") {
            toast.info(notify.summary ?? t("easel.publish.toastAssisted"), {
              description: t("easel.publish.toastAssistedDesc"),
            });
          } else {
            toast.success(notify.summary ?? t("easel.publish.toastPublished"));
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
  const failedCount =
    (counts.failed ?? 0) + (counts.cancelled ?? 0);
  const failedTabLabel = t("easel.publish.failedTab", { count: failedCount });

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
        onSuccess: () => toast.success(t("easel.publish.toastCancelled")),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function onRetry(job: PublishJob) {
    retry.mutate(
      { id: job.id },
      {
        onSuccess: () => toast.success(t("easel.publish.toastRequeued")),
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
          {t("easel.publish.cta")}
        </Button>
        <Button variant="outline" asChild>
          <Link to="/quality">{t("easel.publish.runGate")}</Link>
        </Button>
        <div className="ml-auto flex gap-1">
          {(
            [
              { key: "queue", label: t("easel.publish.queueTab", { count: pendingCount }) },
              { key: "failed", label: failedTabLabel },
              { key: "all", label: t("easel.publish.allTab", { count: jobs.length }) },
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
            <CardTitle className="text-base">{t("easel.publish.capsTitle")}</CardTitle>
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
                  {mode === "api" || mode === "sau" ? (
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
                        {t(MODE_KEYS[mode] ?? "easel.mode.manual")}
                      </span>
                    </div>
                    <div className="text-muted-foreground line-clamp-2 text-xs">
                      {mode === "api"
                        ? t("easel.publish.capApi")
                        : mode === "sau"
                          ? t("easel.publish.capSau")
                          : mode === "assisted"
                            ? t("easel.publish.capAssisted")
                            : t("easel.publish.capManual")}
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
          <CardTitle className="text-base">{t("easel.publish.queueTitle")}</CardTitle>
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
                ? t("easel.publish.queueEmpty")
                : t("easel.publish.tabEmpty")}
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
                    {t(`easel.platform.${job.platform}`, { defaultValue: job.platform })}
                  </Badge>
                  <Badge
                    variant={JOB_STATUS_META[job.status]?.variant ?? "outline"}
                    className="shrink-0"
                  >
                    {JOB_STATUS_META[job.status]
                      ? t(JOB_STATUS_META[job.status].labelKey)
                      : job.status}
                    {job.status === "pending" && job.attempts > 0
                      ? ` · ${t("easel.publish.attempt", { count: job.attempts + 1 })}`
                      : ""}
                  </Badge>
                  <span className="w-16 shrink-0 text-right">
                    {job.status === "pending" || job.status === "cancelled" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={t("easel.publish.cancelJob")}
                        className="text-muted-foreground hover:text-destructive h-7 px-2"
                        onClick={() => onCancel(job)}
                      >
                        <IconX className="size-3.5" strokeWidth={1.8} />
                        {t("easel.common.cancel")}
                      </Button>
                    ) : job.status === "failed" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={t("easel.publish.retryJob")}
                        title={
                          job.lastError
                            ? t("easel.publish.retryWithError", {
                                error: job.lastError.slice(0, 120),
                              })
                            : t("easel.publish.retryPlain")
                        }
                        className="text-muted-foreground hover:text-foreground h-7 px-2"
                        onClick={() => onRetry(job)}
                      >
                        <IconReload className="size-3.5" strokeWidth={1.8} />
                        {t("easel.common.retry")}
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
          <CardTitle className="text-base">{t("easel.publish.recordsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {recordsQuery.isPending ? (
            <Skeleton className="h-20" />
          ) : records.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("easel.publish.recordsEmpty")}
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
                        {t(`easel.platform.${record.platform}`, { defaultValue: record.platform })}
                      </Badge>
                      {record.status === "manual_assisted" ? (
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 text-amber-900"
                        >
                          {t("easel.publish.pastePending")}
                        </Badge>
                      ) : null}
                      {record.url ? (
                        <a
                          href={record.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs"
                        >
                          {t("easel.publish.viewPublish")} <IconExternalLink className="size-3" strokeWidth={1.8} />
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
                              .then(() => toast.success(t("easel.publish.copied")))
                              .catch(() => toast.error(t("easel.publish.copyFailed")));
                          }}
                        >
                          <IconClipboardText className="size-3.5" strokeWidth={1.8} />
                          {t("easel.publish.copyPack")}
                        </Button>
                        {record.metrics?.assisted?.webEntry ? (
                          <a
                            href={record.metrics.assisted.webEntry}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs"
                          >
                            {t("easel.publish.openPublishPage", {
                              platform: t(`easel.platform.${record.platform}`, {
                                defaultValue: record.platform,
                              }),
                            })}{" "}
                            <IconExternalLink className="size-3" strokeWidth={1.8} />
                          </a>
                        ) : null}
                        {record.metrics?.assisted?.mediaPaths?.length ? (
                          <span className="text-muted-foreground text-xs">
                            {t("easel.publish.manualUpload", {
                              count: record.metrics.assisted.mediaPaths.length,
                              defaultValue: `需手动上传 ${record.metrics.assisted.mediaPaths.length} 个媒体文件`,
                            })}
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
                        ? t("easel.publish.recordSucceeded")
                        : record.status === "manual_assisted"
                          ? t("easel.publish.recordAssisted")
                          : t("easel.publish.recordFailed")}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="text-muted-foreground mt-4 text-xs">
            {t("easel.publish.metricsHintPrefix")}
            <Link to="/metrics" className="hover:text-foreground underline underline-offset-2">
              {t("easel.publish.metricsHintLink")}
            </Link>{" "}
            {t("easel.publish.metricsHintSuffix")}
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
