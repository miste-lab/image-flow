import React from "react";
import { NodeResizeControl } from "@xyflow/react";

// ノード右下のリサイズつまみ (掴んで縦横に伸縮できる)
export default function ResizeGrip({ minWidth = 200, minHeight = 120 }) {
  return (
    <NodeResizeControl
      position="bottom-right"
      minWidth={minWidth}
      minHeight={minHeight}
      style={{ background: "transparent", border: "none", width: 22, height: 22 }}
    >
      <svg
        className="resize-grip"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M11 5L5 11" />
        <path d="M11 9l-2 2" />
      </svg>
    </NodeResizeControl>
  );
}
