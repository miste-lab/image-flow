import React, { useCallback } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import RatioSelect from "./RatioSelect.jsx";
import { generateImages } from "../api.js";

const QUALITIES = [
  { value: "auto", label: "品質: 自動" },
  { value: "low", label: "low (最安)" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high (最高)" },
];

export default function GenerateNode({ id, data }) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow();
  const count = data.count ?? 1;
  const results = data.results ?? [];

  // このノードに接続された入力(プロンプト/画像/上流の生成結果)を集める
  const collectInputs = useCallback(() => {
    const nodes = getNodes();
    const edges = getEdges();
    const incoming = edges.filter((e) => e.target === id);

    const prompts = [];
    const images = [];

    for (const edge of incoming) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src) continue;
      if (src.type === "prompt" && src.data.text?.trim()) {
        prompts.push(src.data.text.trim());
      } else if (src.type === "imageInput" && src.data.image) {
        images.push(src.data.image);
      } else if (src.type === "generate" && src.data.results?.length) {
        // 上流の生成結果を参照画像としてチェーン
        images.push(...src.data.results);
      }
    }
    return { prompt: prompts.join("\n"), images };
  }, [id, getNodes, getEdges]);

  const run = useCallback(async () => {
    const { prompt, images } = collectInputs();
    updateNodeData(id, { loading: true, error: null });

    try {
      const list = await generateImages({
        prompt,
        images,
        size: data.size,
        quality: data.quality,
        n: count,
      });
      updateNodeData(id, { results: list, loading: false, error: null });
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    }
  }, [id, data.size, data.quality, count, collectInputs, updateNodeData]);

  const setCount = (delta) => {
    updateNodeData(id, { count: Math.min(4, Math.max(1, count + delta)) });
  };

  return (
    <div className="node node-generate">
      <Handle type="target" position={Position.Left} />

      <div className="node-header">
        <span className="node-dot dot-generate" />
        生成 — gpt-image-2
      </div>

      <div className="result-area">
        {data.loading ? (
          <div className="result-placeholder">
            <span className="spinner" />
            生成中… (最大2分)
          </div>
        ) : results.length > 0 ? (
          <div className={`result-grid ${results.length > 1 ? "multi" : ""}`}>
            {results.map((img, i) => (
              <div className="result-cell" key={i}>
                <img className="result-image" src={img} alt={`generated ${i + 1}`} />
                <a
                  className="cell-save nodrag"
                  href={img}
                  download={`image-flow-${id}-${i + 1}.png`}
                  title="この画像を保存"
                >
                  ↓
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="result-placeholder">
            プロンプトを接続して
            <br />
            「生成」を押してください
          </div>
        )}
      </div>

      {data.error && <div className="error-box">{data.error}</div>}

      <div className="param-row nodrag">
        <RatioSelect
          value={data.size}
          onChange={(size) => updateNodeData(id, { size })}
        />
      </div>

      <div className="param-row nodrag">
        <select
          value={data.quality}
          onChange={(e) => updateNodeData(id, { quality: e.target.value })}
        >
          {QUALITIES.map((q) => (
            <option key={q.value} value={q.value}>{q.label}</option>
          ))}
        </select>
      </div>

      <div className="action-row nodrag">
        <div className="count-stepper">
          <button onClick={() => setCount(-1)} disabled={count <= 1}>−</button>
          <span className="count-value">{count}</span>
          <button onClick={() => setCount(1)} disabled={count >= 4}>＋</button>
        </div>
        <button className="run-btn" onClick={run} disabled={data.loading}>
          {data.loading ? "生成中…" : count > 1 ? `${count}枚生成` : "生成"}
        </button>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
