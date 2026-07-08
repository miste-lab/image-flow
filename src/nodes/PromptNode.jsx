import React from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import ResizeGrip from "./ResizeGrip.jsx";

export default function PromptNode({ id, data }) {
  const { updateNodeData } = useReactFlow();

  return (
    <div className="node node-prompt">
      <div className="node-header">
        <span className="node-dot dot-prompt" />
        プロンプト
      </div>
      <textarea
        className="nodrag nowheel prompt-textarea"
        placeholder="生成したい画像の内容を入力…"
        value={data.text}
        onChange={(e) => updateNodeData(id, { text: e.target.value })}
      />
      {/* 右上固定・[T]アイコンの出力ハンドル */}
      <Handle type="source" position={Position.Right} className="io-handle io-handle-prompt">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M6 6h12" />
          <path d="M12 6v13" />
        </svg>
      </Handle>
      <ResizeGrip minWidth={220} minHeight={140} />
    </div>
  );
}
