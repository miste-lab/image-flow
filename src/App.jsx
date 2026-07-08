import React, { useCallback, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";

import PromptNode from "./nodes/PromptNode.jsx";
import ImageInputNode from "./nodes/ImageInputNode.jsx";
import GenerateNode from "./nodes/GenerateNode.jsx";
import KeyPanel from "./nodes/KeyPanel.jsx";
import DeletableEdge from "./edges/DeletableEdge.jsx";

const nodeTypes = {
  prompt: PromptNode,
  imageInput: ImageInputNode,
  generate: GenerateNode,
};

const edgeTypes = {
  deletable: DeletableEdge,
};

const defaultEdgeOptions = { type: "deletable" };

// 起動時のサンプル構成: プロンプト → 生成
const initialNodes = [
  {
    id: "prompt-1",
    type: "prompt",
    position: { x: 80, y: 160 },
    data: { text: "" },
  },
  {
    id: "generate-1",
    type: "generate",
    position: { x: 460, y: 100 },
    data: { size: "auto", quality: "auto", resolution: "auto", count: 1, results: [], loading: false, error: null },
  },
];

const initialEdges = [
  { id: "e1", source: "prompt-1", target: "generate-1", type: "deletable" },
];

let idCounter = 2;
const nextId = (prefix) => `${prefix}-${++idCounter}`;

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const wrapperRef = useRef(null);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, type: "deletable" }, eds)),
    [setEdges]
  );

  const addNode = useCallback(
    (type) => {
      const defaults = {
        prompt: { text: "" },
        imageInput: { image: null, fileName: null },
        generate: { size: "auto", quality: "auto", resolution: "auto", count: 1, results: [], loading: false, error: null },
      };
      // 画面中央あたりに少しずらしながら配置
      const offset = (idCounter % 5) * 32;
      setNodes((nds) => [
        ...nds,
        {
          id: nextId(type),
          type,
          position: { x: 240 + offset, y: 220 + offset },
          data: defaults[type],
        },
      ]);
    },
    [setNodes]
  );

  return (
    <div className="app" ref={wrapperRef}>
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark" />
          Image Flow
          <span className="brand-model">gpt-image-2</span>
        </div>
        <div className="toolbar-actions">
          <button className="tool-btn" onClick={() => addNode("prompt")}>
            ＋ プロンプト
          </button>
          <button className="tool-btn" onClick={() => addNode("imageInput")}>
            ＋ 画像
          </button>
          <button className="tool-btn accent" onClick={() => addNode("generate")}>
            ＋ 生成ノード
          </button>
        </div>
        <div className="toolbar-right">
          <span className="toolbar-hint">線にカーソルを合わせてハサミで切断 / ノードは選択して Backspace で削除</span>
          <KeyPanel />
        </div>
      </header>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
      >
        <Background gap={22} size={1.2} color="#232a38" />
        <Controls position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          nodeColor={() => "#2c3550"}
          maskColor="rgba(8, 10, 16, 0.75)"
        />
      </ReactFlow>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
