import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import { streamFile } from "@agent-native/core/server";
import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { outputsDir } from "../../lib/outputs-store.js";

/**
 * Serves previewable artifacts: GET /outputs/<path...>
 *
 * Content library media previews (<img>/<video>/<audio>) hit this route. The
 * global auth guard covers it like every other request. Path traversal is
 * rejected twice: segment checks and a resolved-path prefix assertion.
 *
 * Node-targeted like the first-party templates (analytics/slides use the same
 * streamFile + fs pattern for local artifacts).
 */
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
};

export default defineEventHandler(async (event) => {
  const raw = getRouterParam(event, "path");
  const segments = Array.isArray(raw) ? raw : (raw ?? "").split("/");
  const decoded = segments.map((segment) => decodeURIComponent(segment));

  if (
    decoded.length === 0 ||
    decoded.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    setResponseStatus(event, 400);
    return { error: "Invalid path" };
  }

  const base = outputsDir();
  const filepath = resolve(base, ...decoded);
  if (!filepath.startsWith(base + sep)) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }

  try {
    const info = await stat(filepath);
    if (!info.isFile()) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }
    const contentType =
      CONTENT_TYPES[extname(filepath).toLowerCase()] ??
      "application/octet-stream";
    setResponseHeader(event, "Content-Type", contentType);
    setResponseHeader(
      event,
      "Cache-Control",
      "private, max-age=300, must-revalidate",
    );
    return streamFile(createReadStream(filepath));
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
});
