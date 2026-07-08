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
        width: 32,
        height: 32,
        // SVGの左上がノード枠の丸角の中心 (角から12px内側) に来る位置。
        // 弧が枠の丸みに沿って約6px外側を並走する
        left: "auto",
        top: "auto",
        right: -20,
        bottom: -20,
        transform: "none",
        translate: "none", // React Flow既定の translate(-50%) を打ち消す
      }}
    >
      <svg
        className="resize-grip"
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      >
        {/* 枠の丸角(border-radius 12)と中心を揃えた1/4弧。半径19=枠の丸み+すき間 */}
        <path d="M21 2 A 19 19 0 0 1 2 21" />
      </svg>
    </NodeResizeControl>
  );
}
