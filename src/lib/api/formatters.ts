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
