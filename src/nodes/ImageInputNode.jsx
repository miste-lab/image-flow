import React, { useRef } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import ResizeGrip from "./ResizeGrip.jsx";

export default function ImageInputNode({ id, data }) {
  const { updateNodeData } = useReactFlow();
  const fileRef = useRef(null);

  const onFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      updateNodeData(id, { image: reader.result, fileName: file.name });
    reader.readAsDataURL(file);
  };

  return (
    <div className="node node-image">
      <div className="node-header">
        <span className="node-dot dot-image" />
        参照画像 #{(String(id).match(/(\d+)$/) || [])[1] || "?"}
      </div>

      {data.image ? (
        <div className="image-preview-wrap">
          {/* ボックスに合わせて伸縮 (アスペクト比は維持) */}
          <div className="image-preview-box">
            <img className="image-preview" src={data.image} alt={data.fileName || "input"} />
          </div>
          <div className="image-meta">
            <span className="image-name" title={data.fileName}>{data.fileName}</span>
            <button
              className="mini-btn nodrag"
              onClick={() => updateNodeData(id, { image: null, fileName: null })}
            >
              変更
            </button>
          </div>
        </div>
      ) : (
        <button
          className="upload-area nodrag"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation(); // キャンバス側のドロップ処理と二重にならないように
            onFile(e.dataTransfer.files?.[0]);
          }}
        >
          クリックして画像を選択
          <span className="upload-sub">またはここにドロップ</span>
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {/* 右上固定・画像アイコンの出力ハンドル */}
      <Handle type="source" position={Position.Right} className="io-handle io-handle-image">
        <svg
          width="13"
          height="13"
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
      </Handle>
      <ResizeGrip minWidth={180} minHeight={160} />
    </div>
  );
}
