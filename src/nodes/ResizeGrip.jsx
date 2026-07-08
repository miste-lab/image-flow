import React from "react";
import { NodeResizeControl } from "@xyflow/react";

// ノード右下のリサイズつまみ。
// ノード枠の「外側」に弧を描く (中のスクロールバー等と被らないため)。
// ノードにカーソルを乗せているときだけ表示される (styles.css の .resize-grip)
export default function ResizeGrip({ minWidth = 200, minHeight = 120 }) {
  return (
    <NodeResizeControl
      position="bottom-right"
      minWidth={minWidth}
      minHeight={minHeight}
      style={{
        background: "transparent",
        border: "none",
        width: 26,
        height: 26,
        // 掴める範囲ごと枠の外側へ出す
        left: "auto",
        top: "auto",
        right: -16,
        bottom: -16,
        transform: "none",
      }}
    >
      <svg
        className="resize-grip"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      >
        {/* 角の外側を回る 1/4 円弧 */}
        <path d="M3 15 A 12 12 0 0 0 15 3" />
      </svg>
    </NodeResizeControl>
  );
}
