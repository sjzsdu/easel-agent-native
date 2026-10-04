import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconAlertTriangle, IconChartLine } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link } from "react-router";

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
import { addDaysIso, askAgent, todayIso, useDayLabel, useWeekdayNames } from "@/lib/easel";

export function meta() {
  return [{ title: `工作台 — ${APP_TITLE}` }];
}

export default function DashboardRoute() {
  const t = useT();
  const dayLabel = useDayLabel();
  useSetPageTitle(t("easel.nav.dashboard"));

  const profiles = useActionQuery("profiles", {});
  const ideas = useActionQuery("ideas", {});
  const outputs = useActionQuery("outputs", {});
  const doctor = useActionQuery("doctor", {});
  const metricsTrends = useActionQuery("metrics-trends", { topN: 5 });
  const range = useMemo(() => {
    const today = todayIso();
    return { start: today, end: addDaysIso(today, 14) };
  }, []);
  const calendar = useActionQuery("calendar", {
    startDate: range.start,
    endDate: range.end,
  });

  const activeProfile = profiles.data?.profiles.find((p) => p.active);
  const pendingIdeas = ideas.data?.ideas.filter((i) => i.status === "pending").length ?? 0;
  const upcoming = calendar.data?.upcoming14 ?? 0;
  const projectTotal = outputs.data?.total ?? 0;
  const loading =
    profiles.isPending ||
    ideas.isPending ||
    outputs.isPending ||
    calendar.isPending;
  const allEmpty =
    (profiles.data?.total ?? 0) === 0 &&
    (ideas.data?.total ?? 0) === 0 &&
    projectTotal === 0;

  const failedChecks = doctor.data?.checks.filter((c) => !c.ok) ?? [];

  const attribution = metricsTrends.data as
    | {
        coverage: { publishedSucceeded: number; withMetrics: number; missingMetrics: number; coveragePct: number };
        top: { rank: number; recordId: string; title: string; label: string; interactions: number }[];
        weekdayPattern: { weekday: number; label: string; records: number; avgEngagement: number | null }[];
        source: string;
      }
    | undefined;
  const topContent = attribution?.top ?? [];
  const weekdayNames = useWeekdayNames();
  const bestWeekday = (attribution?.weekdayPattern ?? [])
    .filter((w) => w.records >= 3 && w.avgEngagement != null)
    .sort((a, b) => (b.avgEngagement ?? 0) - (a.avgEngagement ?? 0))[0];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 lg:p-6">
      {doctor.data && !doctor.data.ok ? (
        <div className="border-warning/50 bg-warning/10 text-warning-foreground flex items-start gap-2 rounded-lg border p-3 text-sm">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.8} />
          <div className="min-w-0">
            {failedChecks.map((check) => (
              <div key={check.name}>
                {check.label}: {check.detail}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))
        ) : (
          <>
            <Link
              to="/profile"
              className="border-border bg-card hover:bg-accent/50 rounded-lg border p-4 transition-colors"
            >
              <div className="text-muted-foreground text-xs">{t("easel.dashboard.activeProfile")}</div>
              <div className="mt-1 truncate text-lg font-semibold">
                {activeProfile?.name ?? t("easel.dashboard.noProfile")}
              </div>
            </Link>
            <Link
              to="/ideas"
              className="border-border bg-card hover:bg-accent/50 rounded-lg border p-4 transition-colors"
            >
              <div className="text-muted-foreground text-xs">{t("easel.dashboard.pendingIdeas")}</div>
              <div className="mt-1 text-lg font-semibold">{pendingIdeas}</div>
            </Link>
            <Link
              to="/calendar"
              className="border-border bg-card hover:bg-accent/50 rounded-lg border p-4 transition-colors"
            >
              <div className="text-muted-foreground text-xs">{t("easel.dashboard.schedule14")}</div>
              <div className="mt-1 text-lg font-semibold">{upcoming}</div>
            </Link>
            <Link
              to="/outputs"
              className="border-border bg-card hover:bg-accent/50 rounded-lg border p-4 transition-colors"
            >
              <div className="text-muted-foreground text-xs">{t("easel.dashboard.projects")}</div>
              <div className="mt-1 text-lg font-semibold">{projectTotal}</div>
            </Link>
          </>
        )}
      </div>

      {allEmpty && !loading ? (
        <Card>
          <CardContent className="text-muted-foreground space-y-4 p-6 text-sm">
            <p>{t("easel.dashboard.emptyText")}</p>
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  askAgent(
                    "帮我初始化 Easel 工作台：先用 profile-builder 技能引导我建立第一个账号画像，然后跑 trending-topics 结合画像出 3 个选题存入选题库。",
                    "easel:bootstrap",
                  )
                }
              >
                {t("easel.dashboard.bootstrapCta")}
              </Button>
              <Button variant="outline" asChild>
                <Link to="/trends">{t("easel.dashboard.seeTrends")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("easel.dashboard.scheduleTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {calendar.isPending ? (
                <Skeleton className="h-24" />
              ) : (calendar.data?.events.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-sm">{t("easel.dashboard.noSchedule")}</p>
              ) : (
                calendar.data?.events.slice(0, 5).map((event) => (
                  <div key={event.id} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-16 shrink-0 tabular-nums">
                      {dayLabel(event.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{event.title}</span>
                    <Badge variant="secondary">
                      {t(`easel.status.${event.status ?? ""}`, { defaultValue: event.status ?? "" })}
                    </Badge>
                  </div>
                ))
              )}
              {(calendar.data?.total ?? 0) > 5 ? (
                <Link
                  to="/calendar"
                  className="text-muted-foreground hover:text-foreground inline-block text-xs"
                >
                  {t("easel.dashboard.viewAllEvents", { count: calendar.data?.total ?? 0 })}
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <IconChartLine className="size-4" strokeWidth={1.8} />
                {t("easel.dashboard.attributionTitle")}
                <span className="text-muted-foreground ml-auto text-xs font-normal">
                  {t("easel.dashboard.attributionNote")}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {metricsTrends.isPending ? (
                <Skeleton className="h-24" />
              ) : !attribution || attribution.coverage.withMetrics === 0 ? (
                <div className="text-muted-foreground space-y-2 text-sm">
                  <p>
                    {t("easel.dashboard.noMetricsPrefix")}
                    <Link to="/metrics" className="hover:text-foreground mx-1 underline underline-offset-2">
                      {t("easel.dashboard.attributionPage")}
                    </Link>
                    {t("easel.dashboard.noMetricsSuffix")}
                  </p>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/metrics">{t("easel.dashboard.goEnter")}</Link>
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-muted/50 rounded-md p-2">
                      <div className="text-muted-foreground text-xs">{t("easel.dashboard.published")}</div>
                      <div className="text-lg font-semibold tabular-nums">
                        {attribution.coverage.publishedSucceeded}
                      </div>
                    </div>
                    <div className="bg-muted/50 rounded-md p-2">
                      <div className="text-muted-foreground text-xs">{t("easel.dashboard.withData")}</div>
                      <div className="text-lg font-semibold tabular-nums">
                        {attribution.coverage.withMetrics}
                      </div>
                    </div>
                    <div className="bg-muted/50 rounded-md p-2">
                      <div className="text-muted-foreground text-xs">{t("easel.dashboard.coverage")}</div>
                      <div className="text-lg font-semibold tabular-nums">
                        {attribution.coverage.coveragePct}%
                      </div>
                    </div>
                  </div>
                  {topContent.length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="text-muted-foreground text-xs">{t("easel.dashboard.bestContent")}</div>
                      {topContent.slice(0, 3).map((item) => (
                        <div key={item.recordId} className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground w-4 text-center text-xs tabular-nums">
                            {item.rank}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          <span className="shrink-0 text-xs tabular-nums">
                            {t("easel.dashboard.interactions", { count: item.interactions })}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {bestWeekday ? (
                    <p className="text-muted-foreground text-xs">
                      {t("easel.dashboard.bestWeekday", {
                        day: weekdayNames[bestWeekday.weekday] ?? bestWeekday.label,
                        count: bestWeekday.records,
                      })}
                    </p>
                  ) : null}
                  <Link
                    to="/metrics"
                    className="text-muted-foreground hover:text-foreground inline-block text-xs"
                  >
                    {t("easel.dashboard.viewFull")}
                  </Link>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("easel.dashboard.recentTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {outputs.isPending ? (
                <Skeleton className="h-24" />
              ) : projectTotal === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("easel.dashboard.noRecent")}
                </p>
              ) : (
                outputs.data?.projects?.slice(0, 4).map((project) => (
                  <div key={project.topic} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {project.manifest.title || project.topic}
                    </span>
                    <Badge variant="secondary">
                      {t(`easel.status.${project.manifest.status ?? "draft"}`, {
                        defaultValue: project.manifest.status ?? "draft",
                      })}
                    </Badge>
                  </div>
                ))
              )}
              {projectTotal > 4 ? (
                <Link
                  to="/outputs"
                  className="text-muted-foreground hover:text-foreground inline-block text-xs"
                >
                  {t("easel.dashboard.viewAllProjects", { count: projectTotal })}
                </Link>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
