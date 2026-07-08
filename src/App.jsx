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
import Portal from "./Portal.jsx";
import { makeDefaults, makeId } from "./defaults.js";
import { getWorkspace, putWorkspace } from "./db.js";

const nodeTypes = {
  prompt: PromptNode,
  imageInput: ImageInputNode,
  generate: GenerateNode,
};

const edgeTypes = {
  deletable: DeletableEdge,
};

const defaultEdgeOptions = { type: "deletable" };

function Flow({ workspaceId, onBack }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [wsName, setWsName] = useState("");
  const [ready, setReady] = useState(false);
  const wrapperRef = useRef(null);
  const { screenToFlowPosition } = useReactFlow();

  // ワークスペースを IndexedDB から読み込む
  useEffect(() => {
    let alive = true;
    getWorkspace(workspaceId).then((ws) => {
      if (!alive) return;
      if (!ws) {
        onBack(); // 存在しないIDなら一覧へ戻す
        return;
      }
      setNodes(ws.nodes || []);
      setEdges(ws.edges || []);
      setWsName(ws.name || "無題");
      setReady(true);
    });
    return () => { alive = false; };
  }, [workspaceId, onBack, setNodes, setEdges]);

  // 変更を自動保存 (0.6秒デバウンス)
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      putWorkspace({ id: workspaceId, name: wsName, updatedAt: Date.now(), nodes, edges });
    }, 600);
    return () => clearTimeout(t);
  }, [nodes, edges, wsName, ready, workspaceId]);

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
    const newId = makeId("generate", nodes);
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
  }, [connectMenu, nodes, setNodes, setEdges]);

  const addNode = useCallback(
    (type) => {
      setNodes((nds) => {
        // 画面中央あたりに少しずらしながら配置
        const offset = (nds.length % 5) * 32;
        return [
          ...nds,
          {
            id: makeId(type, nds),
            type,
            position: { x: 240 + offset, y: 220 + offset },
            data: makeDefaults(type),
          },
        ];
      });
    },
    [setNodes]
  );

  return (
    <div className="app" ref={wrapperRef}>
      <header className="toolbar">
        <button className="tool-btn back-btn" onClick={onBack} title="ワークスペース一覧へ戻る">
          ←
        </button>
        <div className="brand">
          <span className="brand-mark" />
          <input
            className="ws-name-input"
            value={wsName}
            onChange={(e) => setWsName(e.target.value)}
            title="ワークスペース名 (クリックで編集)"
          />
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

      {ready && (
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
          <Background gap={22} size={1.2} color="#1e1e21" />
          <Controls position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            nodeColor={() => "#26262a"}
            maskColor="rgba(6, 6, 8, 0.8)"
          />
        </ReactFlow>
      )}

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
  // URLハッシュ (#w=ID) で開いているワークスペースを覚える
  const [route, setRoute] = useState(() => {
    const m = window.location.hash.match(/^#w=(.+)$/);
    return m ? { page: "editor", id: decodeURIComponent(m[1]) } : { page: "portal" };
  });

  const openWorkspace = useCallback((id) => {
    window.location.hash = `w=${encodeURIComponent(id)}`;
    setRoute({ page: "editor", id });
  }, []);

  const goPortal = useCallback(() => {
    window.location.hash = "";
    setRoute({ page: "portal" });
  }, []);

  if (route.page === "portal") {
    return <Portal onOpen={openWorkspace} />;
  }

  return (
    <ReactFlowProvider>
      <Flow key={route.id} workspaceId={route.id} onBack={goPortal} />
    </ReactFlowProvider>
  );
}
