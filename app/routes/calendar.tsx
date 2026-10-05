import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  IconChevronRight,
  IconExternalLink,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { askAgent, todayIso, useDayLabel } from "@/lib/easel";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `日历 — ${APP_TITLE}` }];
}

const STATUS_ORDER = ["idea", "draft", "ready", "published"] as const;
type ContentStatus = (typeof STATUS_ORDER)[number];

const EVENT_TYPE_KEYS: Record<string, string> = {
  holiday: "easel.calendar.eventHoliday",
  ecommerce: "easel.calendar.eventEcommerce",
  platform: "easel.calendar.eventPlatform",
  industry: "easel.calendar.eventIndustry",
};

type CalendarRow = {
  id: string;
  title: string;
  date: string;
  endDate: string | null;
  time: string | null;
  platform: string | null;
  kind: "content" | "event";
  eventType: "holiday" | "ecommerce" | "platform" | "industry" | null;
  status: ContentStatus;
  note: string;
  url: string | null;
  source: string | null;
  ideaId: string | null;
};

export default function CalendarRoute() {
  const t = useT();
  const dayLabel = useDayLabel();
  useSetPageTitle(t("easel.nav.calendar"));
  const [kind, setKind] = useState<"all" | "content" | "event">("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const query = useActionQuery("calendar", {});
  const save = useActionMutation("calendar-save");
  const remove = useActionMutation("calendar-delete");

  const rows = (query.data?.events ?? []) as CalendarRow[];
  const filtered = rows.filter((row) => kind === "all" || row.kind === kind);
  const today = todayIso();
  const busy = save.isPending || remove.isPending;

  const groups = useMemo(() => {
    const byDate = new Map<string, CalendarRow[]>();
    for (const row of filtered) {
      const list = byDate.get(row.date) ?? [];
      list.push(row);
      byDate.set(row.date, list);
    }
    return [...byDate.entries()];
  }, [filtered]);

  function advance(row: CalendarRow) {
    const index = STATUS_ORDER.indexOf(row.status);
    if (index < 0 || index >= STATUS_ORDER.length - 1) return;
    save.mutate(
      {
        id: row.id,
        title: row.title,
        date: row.date,
        endDate: row.endDate ?? "",
        time: row.time ?? "",
        platform: row.platform ?? "",
        kind: row.kind,
        eventType: row.eventType ?? undefined,
        status: STATUS_ORDER[index + 1],
        note: row.note,
        url: row.url ?? "",
        source: row.source ?? "",
        ideaId: row.ideaId ?? "",
      },
      { onError: (error) => toast.error(error.message) },
    );
  }

  function confirmDelete() {
    if (!deletingId) return;
    remove.mutate(
      { id: deletingId },
      {
        onSuccess: () => setDeletingId(null),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() =>
            askAgent(
              "读取内容日历近 14 天的事件与排期，结合激活画像，用 content-calendar 技能给我排未来 7 天的内容计划（每条含平台与形式），逐条用 calendar-save 存进日历。",
              "easel:plan-week",
            )
          }
        >
          {t("easel.calendar.plan7")}
        </Button>
        <div className="flex gap-1">
          {(
            [
              { key: "all", labelKey: "easel.common.all" },
              { key: "content", labelKey: "easel.calendar.content" },
              { key: "event", labelKey: "easel.status.event" },
            ] as const
          ).map((filter) => (
            <Button
              key={filter.key}
              size="sm"
              variant={kind === filter.key ? "secondary" : "ghost"}
              onClick={() => setKind(filter.key)}
            >
              {t(filter.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      {query.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-muted-foreground text-sm">{t("easel.calendar.fetchFailed")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed p-8 text-center text-sm">
          {t("easel.calendar.noEntries")}
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(([date, dayRows]) => (
            <section key={date}>
              <div className="text-muted-foreground mb-1.5 flex items-baseline gap-2 px-1 text-xs font-medium">
                {dayLabel(date)}
                {date === today ? (
                  <span className="text-foreground font-semibold">{t("easel.common.today")}</span>
                ) : null}
              </div>
              <ul className="divide-border border-t">
                {dayRows.map((row) => (
                  <li
                    key={row.id}
                    className="group flex items-center gap-3 border-b py-2.5 text-sm"
                  >
                    <span className="text-muted-foreground w-12 shrink-0 tabular-nums">
                      {row.time ?? (row.endDate ? t("easel.common.allDay") : "—")}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{row.title}</span>
                    {row.kind === "event" ? (
                      <Badge variant="outline">
                        {t(EVENT_TYPE_KEYS[row.eventType ?? ""] ?? "easel.status.event")}
                      </Badge>
                    ) : (
                      <>
                        {row.platform ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            {row.platform}
                          </Badge>
                        ) : null}
                        <Badge variant="secondary">
                          {t(`easel.status.${row.status}`, { defaultValue: row.status })}
                        </Badge>
                      </>
                    )}
                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t("easel.calendar.openLink")}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <IconExternalLink className="size-4" strokeWidth={1.8} />
                      </a>
                    ) : null}
                    {row.kind === "content" && row.status !== "published" ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t("easel.calendar.advanceToNext")}
                            disabled={busy}
                            onClick={() => advance(row)}
                            className="text-muted-foreground hover:text-foreground size-7 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <IconChevronRight className="size-4" strokeWidth={1.8} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("easel.calendar.advanceTo", { status: nextStatusLabel(row.status, t) })}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="size-7 shrink-0" />
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("easel.calendar.deleteEntry")}
                          disabled={busy}
                          onClick={() => setDeletingId(row.id)}
                          className={cn(
                            "text-muted-foreground hover:text-destructive size-7 shrink-0 p-0",
                            "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                          )}
                        >
                          <IconTrash className="size-4" strokeWidth={1.8} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("easel.calendar.deleteEntry")}</TooltipContent>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("easel.calendar.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {rows.find((row) => row.id === deletingId)?.title}
              {t("easel.calendar.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("easel.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className={cn("bg-destructive text-white hover:bg-destructive/90")}
            >
              {t("easel.common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function nextStatusLabel(
  status: ContentStatus,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const index = STATUS_ORDER.indexOf(status);
  const next = STATUS_ORDER[index + 1];
  return next ? t(`easel.status.${next}`, { defaultValue: next }) : "";
}
