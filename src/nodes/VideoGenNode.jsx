import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore } from "@xyflow/react";
import ModelSelect from "./ModelSelect.jsx";
import { generateVideoSeedance } from "../fal.js";

// 動画モデルの選択肢 (単価はドロップダウンに小さく表示される概算・720p時)
const VIDEO_MODELS = [
  { value: "standard", label: "Seedance 2.0", price: "約$0.30/秒" },
  { value: "fast", label: "Seedance 2.0 Fast", price: "約$0.24/秒" },
  { value: "mini", label: "Seedance 2.0 Mini", price: "約$0.15/秒" },
];

const RESOLUTIONS = [
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
];

// 長さ: 自動 + 4〜15秒
const DURATIONS = [
  { value: "auto", label: "長さ: 自動" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 4), label: `${i + 4}秒` })),
];

const ASPECTS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

const idNum = (nodeId) => (String(nodeId).match(/(\d+)$/) || [])[1] || "?";

// 動画生成ノード (Seedance 2.0 / fal.ai)。
// 入力はプロンプト・参照画像 (生成ノードの結果もチェーン可)。
// 生成はfalのキューに入るため、ステータスをポーリングして進捗を表示する
export default function VideoGenNode({ id, data }) {
  const { updateNodeData, getNodes, getEdges, getNode } = useReactFlow();

  const acceptPrompt = useCallback(
    (conn) => getNode(conn.source)?.type === "prompt",
    [getNode]
  );
  const acceptImage = useCallback(
    (conn) => ["imageInput", "generate"].includes(getNode(conn.source)?.type),
    [getNode]
  );

  const model = data.model ?? "standard";

  // 生成中の経過時間表示 (0.5秒刻みで更新)
  const startedAtRef = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!data.loading) {
      startedAtRef.current = null;
      setElapsed(0);
      return;
    }
    if (!startedAtRef.current) startedAtRef.current = Date.now();
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      500
    );
    return () => clearInterval(t);
  }, [data.loading]);

  const fmtElapsed = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  // 接続中の画像ソース数 (表示用)
  const imageCount = useStore((s) => {
    let n = 0;
    for (const e of s.edges) {
      if (e.target !== id) continue;
      const src = s.nodeLookup.get(e.source);
      if (src?.type === "imageInput" && src.data?.image) n += 1;
      else if (src?.type === "generate" && src.data?.results?.length) n += src.data.results.length;
    }
    return n;
  });

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
        images.push(...src.data.results);
      }
    }
    if (data.prompt?.trim()) prompts.push(data.prompt.trim());
    return { prompt: prompts.join("\n"), images };
  }, [id, data.prompt, getNodes, getEdges]);

  const run = useCallback(async () => {
    const { prompt, images } = collectInputs();
    updateNodeData(id, { loading: true, status: "送信中…", error: null });

    try {
      const url = await generateVideoSeedance({
        model,
        prompt,
        images,
        resolution: data.resolution ?? "720p",
        duration: data.duration ?? "auto",
        aspectRatio: data.aspect ?? "auto",
        audio: data.audio ?? true,
        onStatus: (st) => {
          const text =
            st.status === "IN_QUEUE"
              ? st.queue_position != null
                ? `キュー待ち (${st.queue_position + 1}番目)`
                : "キュー待ち…"
              : "生成中…";
          updateNodeData(id, { status: text });
        },
      });
      updateNodeData(id, { videoUrl: url, loading: false, status: null, error: null });
    } catch (err) {
      updateNodeData(id, { loading: false, status: null, error: err.message });
    }
  }, [id, model, data.resolution, data.duration, data.aspect, data.audio, collectInputs, updateNodeData]);

  // 動画をmp4としてダウンロード
  const save = async () => {
    if (!data.videoUrl) return;
    const blob = await (await fetch(data.videoUrl)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `image-flow-video-${Date.now()}.mp4`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="node node-videogen">
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
        title="参照画像をつなぐ (最大9枚)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 15l-5-5-9 9" />
        </svg>
      </Handle>

      <div className="node-header">
        <span className="node-dot dot-video" />
        動画 #{idNum(id)}
        <ModelSelect
          value={model}
          options={VIDEO_MODELS}
          onChange={(m) => updateNodeData(id, { model: m })}
          title="動画モデルを切り替える (単価は720p時の概算)"
        />
      </div>

      {imageCount > 0 && (
        <div className="ref-chips">
          <span className="ref-chip">参照画像 ×{imageCount}</span>
        </div>
      )}

      <textarea
        className="nodrag nowheel gen-prompt-textarea"
        placeholder={"動きやカメラワークも含めて入力…\n(プロンプトノードをつないだ場合は内容が結合されます)"}
        value={data.prompt ?? ""}
        onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
      />

      {/* 結果プレビュー / 進捗 */}
      {(data.loading || data.videoUrl) && (
        <div className="video-result nodrag">
          {data.loading ? (
            <div className="video-progress">
              <span className="spinner" />
              <span>{data.status || "生成中…"}</span>
              <span className="video-elapsed">{fmtElapsed}</span>
            </div>
          ) : (
            <>
              <video className="video-preview" src={data.videoUrl} controls loop />
              <button className="video-save-btn" onClick={save} title="mp4として保存">
                ↓ 動画を保存
              </button>
            </>
          )}
        </div>
      )}

      {data.error && <div className="error-box">{data.error}</div>}

      <div className="param-row nodrag">
        <select
          value={data.resolution ?? "720p"}
          onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.value} value={r.value}>解像度: {r.label}</option>
          ))}
        </select>
        <select
          value={data.duration ?? "auto"}
          onChange={(e) => updateNodeData(id, { duration: e.target.value })}
        >
          {DURATIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </div>

      <div className="param-row nodrag">
        <select
          value={data.aspect ?? "auto"}
          onChange={(e) => updateNodeData(id, { aspect: e.target.value })}
          title="画像入力があるときは画像の比率が優先されます"
        >
          {ASPECTS.map((a) => (
            <option key={a} value={a}>{a === "auto" ? "比率: 自動" : a}</option>
          ))}
        </select>
        <label className="audio-toggle" title="効果音・セリフ入りの音声を同時生成する (料金は同じ)">
          <input
            type="checkbox"
            checked={data.audio ?? true}
            onChange={(e) => updateNodeData(id, { audio: e.target.checked })}
          />
          音声
        </label>
      </div>

      <div className="video-cost-note">
        ※ 動画は画像よりコストが高めです (720pで1秒あたり約$0.15〜0.30)
      </div>

      <div className="action-row nodrag">
        <button className="run-btn" onClick={run} disabled={data.loading}>
          {data.loading ? "生成中…" : "動画を生成"}
        </button>
      </div>
    </div>
  );
}
