import React, { useCallback, useEffect, useState } from "react";
import KeyPanel from "./nodes/KeyPanel.jsx";
import { listWorkspaces, putWorkspace, deleteWorkspace } from "./db.js";
import { newWorkspace } from "./defaults.js";

// サムネイル描画用のノード概算サイズ (実物のおおよその縦横)
const THUMB_SIZE = {
  prompt: [280, 170],
  imageInput: [230, 210],
  generate: [320, 330],
  memo: [260, 190],
};

// ワークスペースのノード配置をSVGでミニチュア描画する
function Thumb({ nodes = [], edges = [] }) {
  if (nodes.length === 0) {
    return <div className="ws-thumb-empty">空のワークスペース</div>;
  }
  const boxes = nodes.map((n) => {
    const [dw, dh] = THUMB_SIZE[n.type] || [200, 150];
    // リサイズ済みノードは実際のサイズで描く
    return { ...n, w: n.width || dw, h: n.height || dh };
  });
  const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
  const pad = 60;
  const minX = Math.min(...boxes.map((b) => b.position.x)) - pad;
  const minY = Math.min(...boxes.map((b) => b.position.y)) - pad;
  const maxX = Math.max(...boxes.map((b) => b.position.x + b.w)) + pad;
  const maxY = Math.max(...boxes.map((b) => b.position.y + b.h)) + pad;
  const center = (b) => [b.position.x + b.w / 2, b.position.y + b.h / 2];

  return (
    <svg
      className="ws-thumb-svg"
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {edges.map((e) => {
        const s = byId[e.source];
        const t = byId[e.target];
        if (!s || !t) return null;
        const [x1, y1] = center(s);
        const [x2, y2] = center(t);
        return (
          <line
            key={e.id}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="#2bd97e" strokeOpacity="0.45" strokeWidth="5"
          />
        );
      })}
      {boxes.map((b) => {
        const img =
          b.type === "generate" ? b.data?.results?.[0]
          : b.type === "imageInput" ? b.data?.image
          : null;
        return (
          <g key={b.id}>
            <rect
              x={b.position.x} y={b.position.y}
              width={b.w} height={b.h} rx="14"
              fill={b.type === "memo" ? "#23200f" : "#18181c"}
              stroke={b.type === "memo" ? "#47401d" : "#2a2a2f"}
              strokeWidth="2"
            />
            {img && (
              <image
                href={img}
                x={b.position.x + 8} y={b.position.y + 8}
                width={b.w - 16} height={b.h - 16}
                preserveAspectRatio="xMidYMid slice"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// 更新日時の相対表示
const relTime = (t) => {
  if (!t) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  return `${days} 日前`;
};

export default function Portal({ onOpen }) {
  const [list, setList] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const refresh = useCallback(() => {
    listWorkspaces().then((ws) =>
      setList((ws || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)))
    );
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    const ws = newWorkspace(`ワークスペース ${(list?.length ?? 0) + 1}`);
    await putWorkspace(ws);
    onOpen(ws.id);
  };

  const rename = async (ws, name) => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== ws.name) {
      await putWorkspace({ ...ws, name: trimmed });
    }
    setEditingId(null);
    refresh();
  };

  const remove = async (ws) => {
    if (!window.confirm(`「${ws.name}」を削除しますか？この操作は元に戻せません。`)) return;
    await deleteWorkspace(ws.id);
    refresh();
  };

  return (
    <div className="portal">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark" />
          Image Flow
          <span className="brand-model">gpt-image-2</span>
        </div>
        <div className="toolbar-right">
          <KeyPanel />
        </div>
      </header>

      <main className="portal-body">
        <div className="portal-head-row">
          <h1 className="portal-title">
            ワークスペース
            {list && <span className="portal-count">({list.length})</span>}
          </h1>
          <button className="new-ws-btn" onClick={create}>＋ 新規作成</button>
        </div>

        {list === null ? null : list.length === 0 ? (
          <div className="portal-empty">
            まだワークスペースがありません。
            <br />
            「＋ 新規作成」から最初のキャンバスを作りましょう。
          </div>
        ) : (
          <div className="ws-grid">
            {list.map((ws) => (
              <div className="ws-card" key={ws.id}>
                <button className="ws-thumb" onClick={() => onOpen(ws.id)}>
                  <Thumb nodes={ws.nodes} edges={ws.edges} />
                </button>
                <div className="ws-meta">
                  {editingId === ws.id ? (
                    <input
                      className="ws-rename-input"
                      defaultValue={ws.name}
                      autoFocus
                      onBlur={(e) => rename(ws, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <button className="ws-name" onClick={() => onOpen(ws.id)} title={ws.name}>
                      {ws.name}
                    </button>
                  )}
                  <div className="ws-sub">
                    <span className="ws-date">{relTime(ws.updatedAt)}</span>
                    <span className="ws-actions">
                      <button className="ws-act" title="名前を変更" onClick={() => setEditingId(ws.id)}>
                        ✎
                      </button>
                      <button className="ws-act danger" title="削除" onClick={() => remove(ws)}>
                        🗑
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
