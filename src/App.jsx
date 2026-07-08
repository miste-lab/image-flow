import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
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

// ノード種別ごとの初期データ (毎回新しいオブジェクトを返す)
const makeDefaults = (type) =>
  ({
    prompt: { text: "" },
    imageInput: { image: null, fileName: null },
    generate: { size: "auto", quality: "auto", resolution: "auto", count: 1, results: [], loading: false, error: null },
  })[type];

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const wrapperRef = useRef(null);
  const { screenToFlowPosition } = useReactFlow();

  // 線を何もない場所で離したときに出す「ノード追加」メニュー
  const [connectMenu, setConnectMenu] = useState(null);
  const menuRef = useRef(null);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, type: "deletable" }, eds)),
    [setEdges]
  );

  // 接続ドラッグが空きスペースで終わったらメニューを表示
  const onConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.isValid) return; // ノードに繋がった場合は通常処理
      const fromNode = connectionState.fromNode;
      if (!fromNode || connectionState.fromHandle?.type !== "source") return;

      const { clientX, clientY } =
        "changedTouches" in event ? event.changedTouches[0] : event;
      const rect = wrapperRef.current.getBoundingClientRect();
      setConnectMenu({
        x: clientX - rect.left,
        y: clientY - rect.top,
        flow: screenToFlowPosition({ x: clientX, y: clientY }),
        sourceId: fromNode.id,
      });
    },
    [screenToFlowPosition]
  );

  // メニューの外をクリックしたら閉じる
  useEffect(() => {
    if (!connectMenu) return;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setConnectMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [connectMenu]);

  // メニューから生成ノードを追加して、線を引いた元ノードと接続
  const addGenerateFromMenu = useCallback(() => {
    if (!connectMenu) return;
    const newId = nextId("generate");
    setNodes((nds) => [
      ...nds,
      {
        id: newId,
        type: "generate",
        position: { x: connectMenu.flow.x, y: connectMenu.flow.y - 24 },
        data: makeDefaults("generate"),
      },
    ]);
    setEdges((eds) => [
      ...eds,
      { id: `e-${connectMenu.sourceId}-${newId}`, source: connectMenu.sourceId, target: newId, type: "deletable" },
    ]);
    setConnectMenu(null);
  }, [connectMenu, setNodes, setEdges]);

  const addNode = useCallback(
    (type) => {
      // 画面中央あたりに少しずらしながら配置
      const offset = (idCounter % 5) * 32;
      setNodes((nds) => [
        ...nds,
        {
          id: nextId(type),
          type,
          position: { x: 240 + offset, y: 220 + offset },
          data: makeDefaults(type),
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
        onConnectEnd={onConnectEnd}
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

      {connectMenu && (
        <div
          className="connect-menu"
          ref={menuRef}
          style={{ left: connectMenu.x, top: connectMenu.y }}
        >
          <button className="connect-menu-btn" onClick={addGenerateFromMenu}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="10" r="1.5" />
              <path d="M21 15l-5-5-9 9" />
            </svg>
            画像生成ツールを追加
          </button>
        </div>
      )}
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
