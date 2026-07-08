import React, { useCallback, useEffect, useState } from "react";
import { Handle, Position, useReactFlow, useStore } from "@xyflow/react";
import ResizeGrip from "./ResizeGrip.jsx";
import { listHistory, getHistoryImage, openHistoryImage } from "../db.js";

const idNum = (nodeId) => (String(nodeId).match(/(\d+)$/) || [])[1] || "?";

// ジョブグリッド: つないだ生成ノードの生成結果(履歴)を一覧表示するノード。
// 画像そのものはノードに持たず、IndexedDB の履歴から読む。
export default function JobGridNode({ id }) {
  const { getNode } = useReactFlow();

  // 入力は生成ノードのみ受け付ける
  const acceptGenerate = useCallback(
    (conn) => getNode(conn.source)?.type === "generate",
    [getNode]
  );

  // 接続中の生成ノードの uid と、生成中かどうかを購読する
  const linked = JSON.parse(
    useStore((s) => {
      const uids = [];
      let loading = false;
      for (const e of s.edges) {
        if (e.target !== id) continue;
        const src = s.nodeLookup.get(e.source);
        if (src?.type !== "generate") continue;
        if (src.data?.uid) uids.push(src.data.uid);
        if (src.data?.loading) loading = true;
      }
      return JSON.stringify({ uids, loading });
    })
  );
  const uidsKey = linked.uids.join(",");

  // 接続中ノードの履歴を読み込む。生成完了(history-changed)で自動更新
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      const set = new Set(uidsKey ? uidsKey.split(",") : []);
      listHistory().then((all) => {
        if (!alive) return;
        setItems(
          (all || [])
            .filter((h) => set.has(h.uid))
            .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        );
      });
    };
    load();
    window.addEventListener("history-changed", load);
    return () => {
      alive = false;
      window.removeEventListener("history-changed", load);
    };
  }, [uidsKey]);

  // フル解像度の画像を取り出してダウンロード
  const save = async (h) => {
    const full = (await getHistoryImage(h.id)) || h.thumb;
    const a = document.createElement("a");
    a.href = full;
    a.download = `image-flow-${h.ts}.png`;
    a.click();
  };

  return (
    <div className="node node-jobgrid">
      <Handle
        id="jobs"
        type="target"
        position={Position.Left}
        className="io-handle io-handle-image io-handle-left"
        isValidConnection={acceptGenerate}
        title="生成ノードをつなぐ"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      </Handle>

      <div className="node-header">
        <span className="node-dot dot-generate" />
        ジョブグリッド #{idNum(id)}
        {items.length > 0 && <span className="jobgrid-count">{items.length}枚</span>}
      </div>

      <div className="jobgrid-scroll nodrag nowheel">
        {linked.loading && (
          <div className="jobgrid-loading">
            <span className="spinner" />
            生成中…
          </div>
        )}
        {items.length === 0 && !linked.loading ? (
          <div className="jobgrid-empty">
            {linked.uids.length === 0 ? (
              <>
                生成ノードの出力を
                <br />
                ここにつないでください
              </>
            ) : (
              <>
                まだ生成結果がありません。
                <br />
                生成するとここに並びます
              </>
            )}
          </div>
        ) : (
          <div className="jobgrid-grid">
            {items.map((h) => (
              <div
                className="jobgrid-cell"
                key={h.id}
                title={`ダブルクリックで拡大\n${h.prompt || ""}\n${new Date(h.ts).toLocaleString()}`}
                onDoubleClick={() => openHistoryImage(h.id, h.thumb)}
              >
                <img className="jobgrid-img" src={h.thumb} alt="生成画像" />
                <button className="cell-save" title="この画像を保存" onClick={() => save(h)}>
                  ↓
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ResizeGrip minWidth={240} minHeight={220} />
    </div>
  );
}
