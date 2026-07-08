import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore } from "@xyflow/react";
import ModelSelect from "./ModelSelect.jsx";
import { generateVideoSeedance, queueStatusLabel } from "../fal.js";
import { addVideoHistory } from "../db.js";
import { makeDefaults, makeId, INIT_SIZE } from "../defaults.js";

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

const MAX_COUNT = 3;

const idNum = (nodeId) => (String(nodeId).match(/(\d+)$/) || [])[1] || "?";

// 動画生成ノード (Seedance 2.0 / fal.ai)。
// 入力: プロンプト / 開始画像 / 終了画像。出力はジョブグリッドへつなげる。
// 生成はfalのキューに入るため、ステータスをポーリングして進捗を表示する
export default function VideoGenNode({ id, data }) {
  const { updateNodeData, getNodes, getEdges, getNode, addNodes, addEdges } = useReactFlow();

  const acceptPrompt = useCallback(
    (conn) => getNode(conn.source)?.type === "prompt",
    [getNode]
  );
  const acceptImage = useCallback(
    (conn) => ["imageInput", "generate"].includes(getNode(conn.source)?.type),
    [getNode]
  );

  const model = data.model ?? "standard";
  const count = Math.min(data.count ?? 1, MAX_COUNT);
  const videoUrls = data.videoUrls ?? (data.videoUrl ? [data.videoUrl] : []);

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

  // 接続中の開始/終了画像の数 (表示用)
  const linked = JSON.parse(
    useStore((s) => {
      let startCount = 0;
      let hasEnd = false;
      for (const e of s.edges) {
        if (e.target !== id) continue;
        const src = s.nodeLookup.get(e.source);
        if (!src) continue;
        const isImg =
          (src.type === "imageInput" && src.data?.image) ||
          (src.type === "generate" && src.data?.results?.length);
        if (!isImg) continue;
        const n = src.type === "generate" ? src.data.results.length : 1;
        if (e.targetHandle === "endImage") hasEnd = true;
        else startCount += n;
      }
      return JSON.stringify({ startCount, hasEnd });
    })
  );

  const collectInputs = useCallback(() => {
    const nodes = getNodes();
    const edges = getEdges();
    const incoming = edges.filter((e) => e.target === id);

    const prompts = [];
    const images = []; // 開始画像 (複数可)
    let endImage = null;
    for (const edge of incoming) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src) continue;
      if (src.type === "prompt" && src.data.text?.trim()) {
        prompts.push(src.data.text.trim());
      } else if (src.type === "imageInput" && src.data.image) {
        if (edge.targetHandle === "endImage") endImage = src.data.image;
        else images.push(src.data.image);
      } else if (src.type === "generate" && src.data.results?.length) {
        if (edge.targetHandle === "endImage") endImage = src.data.results[0];
        else images.push(...src.data.results);
      }
    }
    if (data.prompt?.trim()) prompts.push(data.prompt.trim());
    return { prompt: prompts.join("\n"), images, endImage };
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
        x: me.position.x + (me.measured?.width ?? 340) + 80,
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
    const { prompt, images, endImage } = collectInputs();
    ensureJobGrid();
    updateNodeData(id, { loading: true, status: "送信中…", error: null });

    // 複数本は並列でキューに投げ、全体の進み具合をまとめて表示する
    const states = new Array(count).fill("queue");
    let doneCount = 0;
    const report = (queueSt) => {
      const head = count > 1 ? `(${doneCount}/${count}本 完了) ` : "";
      const label =
        queueSt && count === 1
          ? queueStatusLabel(queueSt)
          : states.includes("progress")
            ? "生成中…"
            : "順番待ち…";
      updateNodeData(id, { status: head + label });
    };

    try {
      const urls = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          generateVideoSeedance({
            model,
            prompt,
            images,
            endImage,
            resolution: data.resolution ?? "720p",
            duration: data.duration ?? "auto",
            aspectRatio: data.aspect ?? "auto",
            audio: data.audio ?? true,
            onStatus: (st) => {
              states[i] = st.status === "IN_PROGRESS" ? "progress" : "queue";
              report(st);
            },
          }).then(async (url) => {
            doneCount += 1;
            states[i] = "done";
            report();
            // 履歴に取り込む (ジョブグリッドとポータルの履歴に反映される)
            await addVideoHistory({ uid: data.uid, prompt, videoUrl: url }).catch(() => {});
            return url;
          })
        )
      );
      updateNodeData(id, { videoUrls: urls, videoUrl: null, loading: false, status: null, error: null });
    } catch (err) {
      updateNodeData(id, { loading: false, status: null, error: err.message });
    }
  }, [id, model, count, data.uid, data.resolution, data.duration, data.aspect, data.audio, collectInputs, ensureJobGrid, updateNodeData]);

  // 動画をmp4としてダウンロード
  const save = async (url, i) => {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `image-flow-video-${Date.now()}-${i + 1}.mp4`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const setCount = (delta) => {
    updateNodeData(id, { count: Math.min(MAX_COUNT, Math.max(1, count + delta)) });
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
        title="開始画像をつなぐ (最初のフレームになる)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M8 9v6l5-3z" />
        </svg>
      </Handle>
      <Handle
        id="endImage"
        type="target"
        position={Position.Left}
        className="io-handle io-handle-image io-handle-left io-target-end"
        isValidConnection={acceptImage}
        title="終了画像をつなぐ (最後のフレームになる。開始画像とセットで使う)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M9 9v6M15 9l-4 3 4 3z" />
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

      {(linked.startCount > 0 || linked.hasEnd) && (
        <div className="ref-chips">
          {linked.startCount > 0 && <span className="ref-chip">開始画像 ×{linked.startCount}</span>}
          {linked.hasEnd && <span className="ref-chip">終了画像</span>}
        </div>
      )}

      <textarea
        className="nodrag nowheel gen-prompt-textarea"
        placeholder={"動きやカメラワークも含めて入力…\n(プロンプトノードをつないだ場合は内容が結合されます)"}
        value={data.prompt ?? ""}
        onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
      />

      {/* 結果プレビュー / 進捗 */}
      {(data.loading || videoUrls.length > 0) && (
        <div className="video-result nodrag">
          {data.loading ? (
            <div className="video-progress">
              <span className="spinner" />
              <span>{data.status || "生成中…"}</span>
              <span className="video-elapsed">{fmtElapsed}</span>
            </div>
          ) : (
            videoUrls.map((url, i) => (
              <React.Fragment key={i}>
                <video className="video-preview" src={url} controls loop />
                <button className="video-save-btn" onClick={() => save(url, i)} title="mp4として保存">
                  ↓ 動画を保存{videoUrls.length > 1 ? ` (${i + 1})` : ""}
                </button>
              </React.Fragment>
            ))
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
        ※ 動画は画像よりコストが高めです (720pで1秒あたり約$0.15〜0.30 × 本数)
      </div>

      <div className="action-row nodrag">
        <div className="count-stepper">
          <button onClick={() => setCount(-1)} disabled={count <= 1}>−</button>
          <span className="count-value">{count}</span>
          <button onClick={() => setCount(1)} disabled={count >= MAX_COUNT}>＋</button>
        </div>
        <button className="run-btn" onClick={run} disabled={data.loading}>
          {data.loading ? "生成中…" : count > 1 ? `${count}本生成` : "動画を生成"}
        </button>
      </div>

      {/* 出力: ジョブグリッドやアップスケールへつなぐ */}
      <Handle type="source" position={Position.Right} className="io-handle io-handle-image" title="ジョブグリッドやアップスケールへつなぐ">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9.5v5l4.5-2.5z" />
        </svg>
      </Handle>
    </div>
  );
}
