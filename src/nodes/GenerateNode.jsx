import React, { useCallback } from "react";
import { Handle, Position, useReactFlow, useStore } from "@xyflow/react";
import RatioSelect from "./RatioSelect.jsx";
import ModelSelect from "./ModelSelect.jsx";
import { generateImages } from "../api.js";
import { generateImagesSeedream } from "../fal.js";
import { addHistory } from "../db.js";
import { makeDefaults, makeId, INIT_SIZE } from "../defaults.js";
import { estimateImageUsd, useUsdJpy, fmtJpy } from "../pricing.js";

// 画像モデルの選択肢 (単価はドロップダウンに小さく表示される概算)
const IMAGE_MODELS = [
  { value: "gpt-image-2", label: "gpt-image-2", price: "$0.006〜0.21/枚" },
  { value: "seedream-lite", label: "Seedream 5.0 Lite", price: "$0.035/枚" },
];

const QUALITIES = [
  { value: "auto", label: "品質: 自動" },
  { value: "low", label: "low (最安)" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high (最高)" },
];

// アスペクト比プリセット(≒1K)を何倍に拡大するか。
// 2倍/4倍しても「辺が16の倍数」の制約は保たれる
// 一度に生成できる枚数の上限
const MAX_COUNT = 3;

const RESOLUTIONS = [
  { value: "auto", label: "解像度: 自動", mult: 1 },
  { value: "1k", label: "1K (標準)", mult: 1 },
  { value: "2k", label: "2K (2倍)", mult: 2 },
  { value: "4k", label: "4K (4倍)", mult: 4 },
];

// ノードIDの末尾の数字 (imageInput-6 → 6)
const idNum = (nodeId) => (String(nodeId).match(/(\d+)$/) || [])[1] || "?";

export default function GenerateNode({ id, data }) {
  const { updateNodeData, getNodes, getEdges, getNode, addNodes, addEdges } = useReactFlow();

  // ハンドルごとに受け付ける接続元を制限する
  const acceptPrompt = useCallback(
    (conn) => getNode(conn.source)?.type === "prompt",
    [getNode]
  );
  const acceptImage = useCallback(
    (conn) => ["imageInput", "generate"].includes(getNode(conn.source)?.type),
    [getNode]
  );
  // 上限3枚 (旧データに4が残っていてもここで丸める)
  const count = Math.min(data.count ?? 1, MAX_COUNT);
  const resolution = data.resolution ?? "auto";
  const model = data.model ?? "gpt-image-2";

  // 実行前のコスト概算 (設定が変わるたびに再計算)
  const rate = useUsdJpy();
  const estUsd = estimateImageUsd({
    model,
    quality: data.quality ?? "auto",
    resolution,
    count,
  });

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
    // このノード自身のプロンプト欄も結合する (接続分のあとに追加)
    if (data.prompt?.trim()) prompts.push(data.prompt.trim());
    return { prompt: prompts.join("\n"), images };
  }, [id, data.prompt, getNodes, getEdges]);

  // ジョブグリッドが1つもつながっていなければ、右隣に自動作成してつなぐ
  const ensureJobGrid = useCallback(() => {
    const hasGrid = getEdges().some(
      (e) => e.source === id && getNode(e.target)?.type === "jobGrid"
    );
    if (hasGrid) return;
    const me = getNode(id);
    const newId = makeId("jobGrid", getNodes());
    addNodes({
      id: newId,
      type: "jobGrid",
      position: {
        x: me.position.x + (me.measured?.width ?? 320) + 80,
        y: me.position.y,
      },
      ...INIT_SIZE.jobGrid,
      data: makeDefaults("jobGrid"),
    });
    addEdges({
      id: `e-${id}-${newId}`,
      source: id,
      target: newId,
      targetHandle: "jobs",
      type: "deletable",
    });
  }, [id, getEdges, getNode, getNodes, addNodes, addEdges]);

  const run = useCallback(async () => {
    const { prompt, images } = collectInputs();
    ensureJobGrid(); // 結果の行き先がない状態で生成しないようにする
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
      // モデルに応じて OpenAI / fal.ai を使い分ける
      const list =
        model === "seedream-lite"
          ? await generateImagesSeedream({
              prompt,
              images,
              size: data.size,
              resolution,
              n: count,
            })
          : await generateImages({
              prompt,
              images,
              size,
              quality: data.quality,
              n: count,
            });
      // results は下流ノードへのチェーン用に保持する (ノード内には表示しない)
      updateNodeData(id, { results: list, loading: false, error: null });
      // 履歴に記録 → つながっているジョブグリッドと、ポータルの履歴一覧に反映される
      addHistory({ uid: data.uid, prompt, images: list });
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    }
  }, [id, data.uid, data.size, data.quality, model, resolution, count, collectInputs, ensureJobGrid, updateNodeData]);

  const setCount = (delta) => {
    updateNodeData(id, { count: Math.min(MAX_COUNT, Math.max(1, count + delta)) });
  };

  return (
    <div className="node node-generate">
      {/* 入力ハンドル: 左下固定。プロンプト(緑)と画像(紫)で分ける */}
      <Handle
        id="prompt"
        type="target"
        position={Position.Left}
        className="io-handle io-handle-prompt io-handle-left io-target-prompt"
        isValidConnection={acceptPrompt}
        title="プロンプトをつなぐ"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z" />
          <path d="M13 3v5h5" />
        </svg>
      </Handle>
      <Handle
        id="image"
        type="target"
        position={Position.Left}
        className="io-handle io-handle-image io-handle-left io-target-image"
        isValidConnection={acceptImage}
        title="参照画像をつなぐ"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 15l-5-5-9 9" />
        </svg>
      </Handle>

      <div className="node-header">
        <span className="node-dot dot-image-gen" />
        画像 #{idNum(id)}
        <ModelSelect
          value={model}
          options={IMAGE_MODELS}
          onChange={(m) => updateNodeData(id, { model: m })}
          title="画像モデルを切り替える"
        />
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

      {/* このノード自身のプロンプト欄。プロンプトノードの内容と改行で結合される */}
      <textarea
        className="nodrag nowheel gen-prompt-textarea"
        placeholder={"プロンプトを入力…\n(プロンプトノードをつないだ場合は内容が結合されます)"}
        value={data.prompt ?? ""}
        onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
      />

      {data.loading && (
        <div className="gen-loading">
          <span className="spinner" />
          生成中… (最大2分)。結果はジョブグリッドと履歴に届きます
        </div>
      )}

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
          disabled={model === "seedream-lite"}
          title={model === "seedream-lite" ? "品質指定は gpt-image-2 のみ (Seedreamは固定単価)" : undefined}
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

      <div
        className="video-cost-note"
        title={`概算です。実際の請求はUSD建て (約$${estUsd.toFixed(3)}) で、為替レートにより変動します`}
      >
        予想コスト <span className="cost-yen">{fmtJpy(estUsd, rate)}</span>
      </div>

      <div className="action-row nodrag">
        <div className="count-stepper">
          <button onClick={() => setCount(-1)} disabled={count <= 1}>−</button>
          <span className="count-value">{count}</span>
          <button onClick={() => setCount(1)} disabled={count >= MAX_COUNT}>＋</button>
        </div>
        <button className="run-btn" onClick={run} disabled={data.loading}>
          {data.loading ? "生成中…" : count > 1 ? `${count}枚生成` : "生成"}
        </button>
      </div>

      {/* 出力(生成画像)は画像扱いなので紫 */}
      <Handle type="source" position={Position.Right} className="io-handle io-handle-image">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 15l-5-5-9 9" />
        </svg>
      </Handle>
    </div>
  );
}
