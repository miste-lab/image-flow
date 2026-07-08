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
        width: 24,
        height: 24,
        // ノードの角にSVGの左上が一致するよう、サイズぶんだけ外へ出す
        left: "auto",
        top: "auto",
        right: -24,
        bottom: -24,
        transform: "none",
        translate: "none", // React Flow既定の translate(-50%) を打ち消す
      }}
    >
      <svg
        className="resize-grip"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      >
        {/* ノードの角(SVG左上のやや外)を中心とした同心円の1/4弧 */}
        <path d="M17 2 A 15 15 0 0 1 2 17" />
      </svg>
    </NodeResizeControl>
  );
}
