/**
 * Easel 工作台屏幕清单 — 侧边栏导航与 agent 导航的唯一真源。
 *
 * 背景: 这份清单此前在 `components/layout/Sidebar.tsx`(WORKSPACE_LINKS) 与
 * `hooks/use-navigation-state.ts`(viewForPath/pathForView) 各写了一份, 新增
 * 页面时只改了侧边栏 — 于是 agent 侧只知道 chat/settings, 用户说"去热点页"
 * 也跳不回工作台。合成一处后两边必然一致。
 */

export interface WorkspaceScreen {
  /** agent `navigate` 命令使用的 view id */
  view: string;
  /** 应用内路由路径 */
  path: string;
  /** 侧边栏显示名 */
  label: string;
}

export const WORKSPACE_SCREENS: readonly WorkspaceScreen[] = [
  { view: "dashboard", path: "/dashboard", label: "Dashboard" },
  { view: "trends", path: "/trends", label: "热点" },
  { view: "ideas", path: "/ideas", label: "选题库" },
  { view: "calendar", path: "/calendar", label: "日历" },
  { view: "skills", path: "/skills", label: "技能库" },
  { view: "outputs", path: "/outputs", label: "内容库" },
  { view: "publish", path: "/publish", label: "发布" },
  { view: "metrics", path: "/metrics", label: "归因" },
  { view: "profile", path: "/profile", label: "画像" },
  { view: "quality", path: "/quality", label: "质检" },
];

/** 屏幕路径 → view id (未命中返回 null)。 */
export function screenViewForPath(pathname: string): string | null {
  const match = WORKSPACE_SCREENS.find((screen) =>
    pathname.startsWith(screen.path),
  );
  return match ? match.view : null;
}

/** view id → 屏幕路径 (未命中返回 null)。 */
export function screenPathForView(view?: string): string | null {
  if (!view) return null;
  const match = WORKSPACE_SCREENS.find((screen) => screen.view === view);
  return match ? match.path : null;
}
