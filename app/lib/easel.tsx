import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useLocale } from "@agent-native/core/client/i18n";
import { useCallback, useMemo } from "react";

/**
 * 把一个边界清楚的任务交给右侧 AgentSidebar (打开并提交), 用户留在当前领域页面。
 * message 必须带足上下文 — 不要只丢一个词。
 */
export function askAgent(message: string, usageLabel?: string): void {
  sendToAgentChat({ message, submit: true, openSidebar: true, usageLabel });
}

/** "2026-09-23" → "09-23 周三" 形式, 星期名跟随界面语言。 */
export function useDayLabel(): (date: string) => string {
  const { locale } = useLocale();
  return useCallback(
    (date: string) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!match) return date;
      const weekday = new Intl.DateTimeFormat(locale, {
        weekday: "short",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`));
      return `${match[2]}-${match[3]} ${weekday}`;
    },
    [locale],
  );
}

/** 界面语言下的星期几短名 (0=周日), 供服务端返回的 weekday 序号本地化。 */
export function useWeekdayNames(): string[] {
  const { locale } = useLocale();
  return useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        // 2024-01-07 是周日
        new Intl.DateTimeFormat(locale, {
          weekday: "short",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(2024, 0, 7 + i))),
      ),
    [locale],
  );
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** ISO 时间戳 → "MM-DD HH:MM" */
export function timestampLabel(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
