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
      <Handle type="source" position={Position.Right} />
      <ResizeGrip minWidth={220} minHeight={140} />
    </div>
  );
}
