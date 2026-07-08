import React from "react";
import { useReactFlow } from "@xyflow/react";
import ResizeGrip from "./ResizeGrip.jsx";

const idNum = (id) => (String(id).match(/(\d+)$/) || [])[1] || "?";

// 付箋メモ。ノード接続はできない、キャンバス上の書き置き用
export default function MemoNode({ id, data }) {
  const { updateNodeData, deleteElements } = useReactFlow();

  return (
    <div className="node node-memo">
      <div className="memo-header">
        <span className="memo-title">メモ #{idNum(id)}</span>
        <button
          className="memo-close nodrag"
          title="メモを削除"
          onClick={() => deleteElements({ nodes: [{ id }] })}
        >
          ×
        </button>
      </div>
      <textarea
        className="memo-textarea nodrag nowheel"
        placeholder="メモを書く…"
        value={data.text || ""}
        onChange={(e) => updateNodeData(id, { text: e.target.value })}
      />
      <ResizeGrip minWidth={180} minHeight={120} />
    </div>
  );
}
