import { markAgentChatHomeHandoff } from "@agent-native/core/client/agentkit-chat/rail";
import { appPath } from "@agent-native/core/client/api-path";
import { useEffect, useRef, useState } from "react";

import { APP_TITLE } from "@/lib/app-config";
import { getChatHomeThreadId } from "@/lib/chat-home-thread";

const SEO_TITLE = `${APP_TITLE} — 私人社媒运营工作台`;
const SEO_DESCRIPTION =
  "从热点发现到内容归因，Easel 把社媒运营的五步流程收进一个工作台：发现、策划、创作、发布、归因。";

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function ChatRoute() {
  const [threadId] = useState(getChatHomeThreadId);
  const handoffStartedRef = useRef(false);

  useEffect(() => {
    if (handoffStartedRef.current) return;
    handoffStartedRef.current = true;
    markAgentChatHomeHandoff("chat");
    try {
      window.location.replace(appPath(`/chat/${encodeURIComponent(threadId)}`));
    } catch (error) {
      handoffStartedRef.current = false;
      throw error;
    }
  }, [threadId]);

  return null;
}
