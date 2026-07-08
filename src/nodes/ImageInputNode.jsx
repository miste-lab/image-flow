import React, { useRef } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";

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
        参照画像
      </div>

      {data.image ? (
        <div className="image-preview-wrap">
          <img className="image-preview" src={data.image} alt={data.fileName || "input"} />
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
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
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

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
