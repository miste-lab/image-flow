import React, { useCallback } from "react";
import { Handle, Position, useReactFlow, useStore } from "@xyflow/react";
import RatioSelect from "./RatioSelect.jsx";
import { generateImages } from "../api.js";

const QUALITIES = [
  { value: "auto", label: "品質: 自動" },
  { value: "low", label: "low (最安)" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high (最高)" },
];

// アスペクト比プリセット(≒1K)を何倍に拡大するか。
// 2倍/4倍しても「辺が16の倍数」の制約は保たれる
const RESOLUTIONS = [
  { value: "auto", label: "解像度: 自動", mult: 1 },
  { value: "1k", label: "1K (標準)", mult: 1 },
  { value: "2k", label: "2K (2倍)", mult: 2 },
  { value: "4k", label: "4K (4倍)", mult: 4 },
];

// ノードIDの末尾の数字 (imageInput-6 → 6)
const idNum = (nodeId) => (String(nodeId).match(/(\d+)$/) || [])[1] || "?";

export default function GenerateNode({ id, data }) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow();
  const count = data.count ?? 1;
  const results = data.results ?? [];
  const resolution = data.resolution ?? "auto";

  // 接続中の画像ソースをタグ付きで列挙 (表示用)。
  // collectInputs と同じエッジ順で数えるので @img:n が実際の送信順と一致する
  const refChips = JSON.parse(
    useStore((s) => {
      const chips = [];
      let imgIndex = 0;
      for (const e of s.edges) {
        if (e.target !== id) continue;
        const src = s.nodeLookup.get(e.source);
        if (!src) continue;
        if (src.type === "imageInput" && src.data?.image) {
          imgIndex += 1;
          chips.push({ label: `参照画像 #${idNum(src.id)}`, tag: `@img:${imgIndex}` });
        } else if (src.type === "generate" && src.data?.results?.length) {
          const n = src.data.results.length;
          const start = imgIndex + 1;
          imgIndex += n;
          chips.push({
            label: `生成 #${idNum(src.id)}`,
            tag: n > 1 ? `@img:${start}-${imgIndex}` : `@img:${start}`,
          });
        }
      }
      return JSON.stringify(chips);
    })
  );

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

    // アスペクト比プリセットに解像度の倍率を掛けて最終サイズを決める。
    // 比率が「自動」のまま解像度だけ指定された場合は正方形を基準にする
    let size = data.size;
    const mult = RESOLUTIONS.find((r) => r.value === resolution)?.mult ?? 1;
    if (resolution !== "auto") {
      const base = size && size !== "auto" ? size : "1024x1024";
      const [w, h] = base.split("x").map(Number);
      size = `${w * mult}x${h * mult}`;
    }

    try {
      const list = await generateImages({
        prompt,
        images,
        size,
        quality: data.quality,
        n: count,
      });
      updateNodeData(id, { results: list, loading: false, error: null });
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    }
  }, [id, data.size, data.quality, resolution, count, collectInputs, updateNodeData]);

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

      {refChips.length > 0 && (
        <div className="ref-chips">
          {refChips.map((c, i) => (
            <span className="ref-chip" key={i}>
              {c.label} <span className="ref-tag">{c.tag}</span>
            </span>
          ))}
        </div>
      )}

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
        <select
          value={resolution}
          onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
          title="出力解像度。比率が「自動」のときは正方形(1024×1024)を基準に拡大します"
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
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
