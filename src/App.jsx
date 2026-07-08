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
import VideoGenNode from "./nodes/VideoGenNode.jsx";
import UpscaleNode from "./nodes/UpscaleNode.jsx";
import JobGridNode from "./nodes/JobGridNode.jsx";
import MemoNode from "./nodes/MemoNode.jsx";
import KeyPanel from "./nodes/KeyPanel.jsx";
import SettingsPanel from "./nodes/SettingsPanel.jsx";
import DeletableEdge from "./edges/DeletableEdge.jsx";
import Portal from "./Portal.jsx";
import ImageViewer from "./ImageViewer.jsx";
import { makeDefaults, makeId, INIT_SIZE } from "./defaults.js";
import { getWorkspace, putWorkspace } from "./db.js";

const nodeTypes = {
  prompt: PromptNode,
  imageInput: ImageInputNode,
  generate: GenerateNode,
  videoGen: VideoGenNode,
  upscale: UpscaleNode,
  jobGrid: JobGridNode,
  memo: MemoNode,
};

const edgeTypes = {
  deletable: DeletableEdge,
};

const defaultEdgeOptions = { type: "deletable" };

// 右クリックメニューの項目
const CONTEXT_ITEMS = [
  { type: "prompt", label: "プロンプトを追加", icon: "text" },
  { type: "imageInput", label: "参照画像を追加", icon: "image" },
  { type: "generate", label: "画像生成ツールを追加", icon: "spark" },
  { type: "videoGen", label: "動画生成ツールを追加", icon: "video" },
  { type: "upscale", label: "アップスケールを追加", icon: "up" },
  { type: "jobGrid", label: "ジョブグリッドを追加", icon: "grid" },
  { type: "memo", label: "付箋メモを追加", icon: "note", divider: true },
];

function MenuIcon({ name }) {
  const paths = {
    text: (
      <>
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h7" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.5" cy="10" r="1.5" />
        <path d="M21 15l-5-5-9 9" />
      </>
    ),
    spark: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M12 8v8" />
        <path d="M8 12h8" />
      </>
    ),
    note: (
      <>
        <path d="M5 4h14v11l-5 5H5z" />
        <path d="M14 20v-5h5" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    video: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 9.5v5l4.5-2.5z" />
      </>
    ),
    up: (
      <>
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </>
    ),
  };
  return (
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
      {paths[name]}
    </svg>
  );
}

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
      // 旧データにはサイズがないので、リサイズ対応ノードに初期サイズを補う
      const migrated = (ws.nodes || []).map((n) => {
        let node = n.width == null && INIT_SIZE[n.type] ? { ...n, ...INIT_SIZE[n.type] } : n;
        // 旧データの生成ノードには uid(履歴用の固有ID)とプロンプト欄がないので補う
        if (node.type === "generate" && !node.data?.uid) {
          node = {
            ...node,
            data: { ...node.data, uid: crypto.randomUUID(), prompt: node.data?.prompt ?? "" },
          };
        }
        // 生成中のままタブを閉じた場合に「生成中…」で固まらないようリセット
        if (["generate", "videoGen", "upscale"].includes(node.type) && node.data?.loading) {
          node = { ...node, data: { ...node.data, loading: false, status: null } };
        }
        return node;
      });
      // 旧エッジは targetHandle がないので、接続元の種類で振り分ける
      const byId = Object.fromEntries(migrated.map((n) => [n.id, n]));
      const migratedEdges = (ws.edges || []).map((e) => {
        if (byId[e.target]?.type === "generate" && !e.targetHandle) {
          const srcType = byId[e.source]?.type;
          return { ...e, targetHandle: srcType === "prompt" ? "prompt" : "image" };
        }
        return e;
      });
      setNodes(migrated);
      setEdges(migratedEdges);
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

  // フローティングメニュー
  //  kind: "connect" = 線を空きスペースで離した / "context" = 右クリック
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, type: "deletable" }, eds)),
    [setEdges]
  );

  // 画面座標 → メニュー表示位置 + キャンバス座標
  const menuPosition = useCallback(
    (clientX, clientY) => {
      const rect = wrapperRef.current.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
        flow: screenToFlowPosition({ x: clientX, y: clientY }),
      };
    },
    [screenToFlowPosition]
  );

  // 接続ドラッグが空きスペースで終わったらメニューを表示
  const onConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.isValid) return; // ノードに繋がった場合は通常処理
      if (connectionState.toNode) return; // 不正なハンドル上で離した場合もメニューは出さない
      const fromNode = connectionState.fromNode;
      if (!fromNode || connectionState.fromHandle?.type !== "source") return;
      const { clientX, clientY } =
        "changedTouches" in event ? event.changedTouches[0] : event;
      setMenu({
        kind: "connect",
        sourceId: fromNode.id,
        sourceType: fromNode.type,
        ...menuPosition(clientX, clientY),
      });
    },
    [menuPosition]
  );

  // 何もない場所を右クリックしたらノード追加メニューを表示
  const onPaneContextMenu = useCallback(
    (event) => {
      event.preventDefault();
      setMenu({ kind: "context", ...menuPosition(event.clientX, event.clientY) });
    },
    [menuPosition]
  );

  // メニューの外をクリックしたら閉じる
  useEffect(() => {
    if (!menu) return;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  // 指定位置にノードを追加 (sourceId があれば線も引く)
  const addNodeAt = useCallback(
    (type, flowPos, sourceId = null) => {
      const newId = makeId(type, nodes);
      setNodes((nds) => [
        ...nds,
        {
          id: newId,
          type,
          position: { x: flowPos.x, y: flowPos.y - 24 },
          ...(INIT_SIZE[type] || {}),
          data: makeDefaults(type),
        },
      ]);
      if (sourceId) {
        // 追加するノードと接続元の種類に応じて入力口を選ぶ
        const srcType = nodes.find((n) => n.id === sourceId)?.type;
        const targetHandle =
          type === "jobGrid" ? "jobs"
          : type === "upscale" ? "video"
          : srcType === "prompt" ? "prompt" : "image";
        setEdges((eds) => [
          ...eds,
          {
            id: `e-${sourceId}-${newId}`,
            source: sourceId,
            target: newId,
            targetHandle,
            type: "deletable",
          },
        ]);
      }
      setMenu(null);
    },
    [nodes, setNodes, setEdges]
  );

  // 画像入りの参照画像ノードを追加 (D&D / Ctrl+V 用)
  const addImageNode = useCallback(
    (flowPos, image, fileName) => {
      setNodes((nds) => [
        ...nds,
        {
          id: makeId("imageInput", nds),
          type: "imageInput",
          position: flowPos,
          ...INIT_SIZE.imageInput,
          data: { image, fileName },
        },
      ]);
    },
    [setNodes]
  );

  // 画像ファイルのドラッグ&ドロップでノード化
  const onDrop = useCallback(
    (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length === 0) return;
      e.preventDefault();
      const { clientX, clientY } = e;
      files.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = () => {
          const pos = screenToFlowPosition({
            x: clientX + i * 40,
            y: clientY + i * 40,
          });
          addImageNode(pos, reader.result, file.name);
        };
        reader.readAsDataURL(file);
      });
    },
    [screenToFlowPosition, addImageNode]
  );

  // クリップボードの画像を Ctrl+V でノード化 (画面中央に置く)
  useEffect(() => {
    const onPaste = (e) => {
      const t = e.target;
      // テキスト入力中は通常の貼り付けを邪魔しない
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const items = [...(e.clipboardData?.items || [])].filter((it) =>
        it.type.startsWith("image/")
      );
      if (items.length === 0) return;
      e.preventDefault();
      const rect = wrapperRef.current.getBoundingClientRect();
      items.forEach((it, i) => {
        const file = it.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const pos = screenToFlowPosition({
            x: rect.left + rect.width / 2 + i * 40,
            y: rect.top + rect.height / 2 + i * 40,
          });
          addImageNode(pos, reader.result, file.name || "クリップボード画像");
        };
        reader.readAsDataURL(file);
      });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [screenToFlowPosition, addImageNode]);

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
            ...(INIT_SIZE[type] || {}),
            data: makeDefaults(type),
          },
        ];
      });
    },
    [setNodes]
  );

  return (
    <div
      className="app"
      ref={wrapperRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
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
          <button className="tool-btn" onClick={() => addNode("videoGen")}>
            ＋ 動画
          </button>
        </div>
        <div className="toolbar-right">
          <span className="toolbar-hint">右クリックでノード追加 / 画像はドロップ・Ctrl+Vでも置ける</span>
          <KeyPanel />
          <SettingsPanel />
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
          onPaneContextMenu={onPaneContextMenu}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={["Backspace", "Delete"]}
          colorMode="dark"
          zoomOnDoubleClick={false} /* ジョブグリッドのダブルクリック拡大と競合するため */
        >
          <Background gap={22} size={1.4} color="#333338" />
          <Controls position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            nodeColor={() => "#26262a"}
            maskColor="rgba(6, 6, 8, 0.8)"
          />
        </ReactFlow>
      )}

      {menu && (
        <div
          className="connect-menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.kind === "connect" ? (
            <>
              {/* 接続元の種類に応じて、つなげるノードだけを出す */}
              {menu.sourceType !== "videoGen" && (
                <>
                  <button
                    className="connect-menu-btn"
                    onClick={() => addNodeAt("generate", menu.flow, menu.sourceId)}
                  >
                    <MenuIcon name="spark" />
                    画像生成ツールを追加
                  </button>
                  <button
                    className="connect-menu-btn"
                    onClick={() => addNodeAt("videoGen", menu.flow, menu.sourceId)}
                  >
                    <MenuIcon name="video" />
                    動画生成ツールを追加
                  </button>
                </>
              )}
              {menu.sourceType === "videoGen" && (
                <button
                  className="connect-menu-btn"
                  onClick={() => addNodeAt("upscale", menu.flow, menu.sourceId)}
                >
                  <MenuIcon name="up" />
                  アップスケールを追加
                </button>
              )}
              {(menu.sourceType === "generate" || menu.sourceType === "videoGen") && (
                <button
                  className="connect-menu-btn"
                  onClick={() => addNodeAt("jobGrid", menu.flow, menu.sourceId)}
                >
                  <MenuIcon name="grid" />
                  ジョブグリッドを追加
                </button>
              )}
            </>
          ) : (
            CONTEXT_ITEMS.map((item) => (
              <React.Fragment key={item.type}>
                {item.divider && <div className="connect-menu-divider" />}
                <button
                  className="connect-menu-btn"
                  onClick={() => addNodeAt(item.type, menu.flow)}
                >
                  <MenuIcon name={item.icon} />
                  {item.label}
                </button>
              </React.Fragment>
            ))
          )}
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
    return (
      <>
        <Portal onOpen={openWorkspace} />
        <ImageViewer />
      </>
    );
  }

  return (
    <ReactFlowProvider>
      <Flow key={route.id} workspaceId={route.id} onBack={goPortal} />
      <ImageViewer />
    </ReactFlowProvider>
  );
}
