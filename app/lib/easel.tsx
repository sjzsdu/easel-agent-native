import { sendToAgentChat } from "@agent-native/core/client/agent-chat";

/**
 * 把一个边界清楚的任务交给右侧 AgentSidebar (打开并提交), 用户留在当前领域页面。
 * message 必须带足上下文 — 不要只丢一个词。
 */
export function askAgent(message: string, usageLabel?: string): void {
  sendToAgentChat({ message, submit: true, openSidebar: true, usageLabel });
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** "2026-09-23" → "09-23 周三" */
export function dayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
  return `${match[2]}-${match[3]}${weekday ? ` ${weekday}` : ""}`;
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
