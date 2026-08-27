import { DataType } from "./types";

/**
 * Format data type for display with emoji
 */
export function formatDataType(dataType: DataType | string): string {
  const labels: Record<DataType, string> = {
    logs_and_errors: "📋 Logs & Errors",
    unstructured_text: "📝 Text",
    structured_config: "⚙️ Configuration",
    metrics_and_performance: "📊 Metrics",
    source_code: "💻 Source Code",
    visual_evidence: "🖼️ Screenshot",
    unanalyzable: "❓ Unknown Format"
  };

  return labels[dataType as DataType] || dataType;
}

/**
 * Format compression ratio for display
 */
export function formatCompression(ratio?: number): string {
  if (!ratio || ratio < 1.5) return "";
  return `(${ratio.toFixed(1)}x compressed)`;
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * The three input origins an attachment chip distinguishes.
 */
export type AttachmentOrigin = "page_capture" | "text_paste" | "file_upload";

/**
 * Input origin of an attachment, for the transcript chip's icon.
 *
 * Reads the provenance tag FIRST and falls back to the synthetic-filename
 * prefix — the same precedence the backend applies in `_is_paste_target`.
 * Both halves matter:
 *
 * - `upload_source` is the tag the backend sets from the turn route's
 *   `source_metadata.source_type`, so it is the authoritative answer. The chip
 *   used to read `source_type`, which is NOT an origin — it carries the
 *   preprocessing data classification (`logs`, `configuration`, …) — so that
 *   comparison never matched and only the filename branch ever worked.
 *
 * - The filename prefix remains as a compatibility fallback for rows whose tag
 *   predates the current values. It no longer fires for new turns:
 *   faultmaven#1198 stopped sending route-minted storage names, so a paste now
 *   arrives as `"pasted text (turn 3)"` and a capture as
 *   `"captured page (turn 2)"`. With both branches dead, every chip fell
 *   through to the generic paperclip — which is the regression this repairs.
 *
 * Both paste spellings are accepted because both occur on
 * `UploadedFile.upload_source`: the turns route tags `text_paste`, older rows
 * carry `paste`, and a deduped re-submission returns the ORIGINAL row's tag.
 */
export function attachmentOrigin(attachment: {
  upload_source?: string;
  filename?: string;
}): AttachmentOrigin {
  const tag = attachment.upload_source;
  if (tag === "page_capture") return "page_capture";
  if (tag === "text_paste" || tag === "paste") return "text_paste";
  if (tag === "file_upload") return "file_upload";

  const filename = attachment.filename ?? "";
  if (filename.startsWith("page-capture-")) return "page_capture";
  if (filename.startsWith("pasted-content-")) return "text_paste";
  return "file_upload";
}
