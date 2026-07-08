import React, { useEffect, useState } from "react";
import { getHistoryImage } from "./db.js";

// 履歴アイテムをアプリ内モーダルで大きく表示するビューア。
// どこからでも openImageViewer(履歴アイテム) で開ける (イベント経由)。
// 本体の <ImageViewer /> は App でポータル/エディタ両方に1つだけ置く。

export function openImageViewer(item) {
  window.dispatchEvent(new CustomEvent("open-image-viewer", { detail: item }));
}

const fmtBytes = (n) => {
  if (n == null) return "—";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export default function ImageViewer() {
  const [item, setItem] = useState(null); // {id, thumb, prompt, ts}
  const [full, setFull] = useState(null);
  const [dim, setDim] = useState(null);
  const [bytes, setBytes] = useState(null);

  useEffect(() => {
    const onOpen = (e) => setItem(e.detail);
    window.addEventListener("open-image-viewer", onOpen);
    return () => window.removeEventListener("open-image-viewer", onOpen);
  }, []);

  // 開いたらフル解像度を読み込み、解像度とファイルサイズを割り出す
  useEffect(() => {
    if (!item) return;
    let alive = true;
    setFull(null);
    setDim(null);
    setBytes(null);
    getHistoryImage(item.id).then((img) => {
      if (!alive) return;
      const url = img || item.thumb;
      setFull(url);
      // dataURL の base64 部分の長さからファイルサイズを概算 (4文字 ≒ 3バイト)
      const b64 = url.split(",")[1] || "";
      setBytes(Math.round((b64.length * 3) / 4));
      const probe = new Image();
      probe.onload = () => {
        if (alive) setDim({ w: probe.naturalWidth, h: probe.naturalHeight });
      };
      probe.src = url;
    });
    const onKey = (e) => {
      if (e.key === "Escape") setItem(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [item]);

  if (!item) return null;

  const save = () => {
    if (!full) return;
    const a = document.createElement("a");
    a.href = full;
    a.download = `image-flow-${item.ts}.png`;
    a.click();
  };

  return (
    <div className="viewer-backdrop" onClick={() => setItem(null)}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-stage">
          {full ? (
            <img className="viewer-image" src={full} alt="生成画像" />
          ) : (
            <span className="spinner" />
          )}
        </div>
        <aside className="viewer-side">
          <div className="viewer-side-head">
            <span className="viewer-title">詳細</span>
            <button className="viewer-close" title="閉じる (Esc)" onClick={() => setItem(null)}>
              ×
            </button>
          </div>
          <dl className="viewer-meta">
            <div className="viewer-row">
              <dt>解像度</dt>
              <dd>{dim ? `${dim.w} × ${dim.h} px` : "…"}</dd>
            </div>
            <div className="viewer-row">
              <dt>ファイルサイズ</dt>
              <dd>{bytes != null ? fmtBytes(bytes) : "…"}</dd>
            </div>
            <div className="viewer-row">
              <dt>日付</dt>
              <dd>{new Date(item.ts).toLocaleString()}</dd>
            </div>
          </dl>
          <button className="viewer-save-btn" onClick={save} disabled={!full}>
            ↓ PNGを保存
          </button>
        </aside>
      </div>
    </div>
  );
}
