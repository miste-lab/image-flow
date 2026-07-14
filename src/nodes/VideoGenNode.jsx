import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore } from "@xyflow/react";
import ModelSelect from "./ModelSelect.jsx";
import { generateVideo, queueStatusLabel, probeVideoMeta } from "../fal.js";
import { addVideoHistory } from "../db.js";
import { recordUsage } from "../usage.js";
import { makeDefaults, makeId, INIT_SIZE } from "../defaults.js";
import { VIDEO_MODELS, estimateVideoUsd, useUsdJpy, fmtJpy, VIDEO_AUTO_DURATION } from "../pricing.js";

// モデル定義 (pricing.js) → ドロップダウンの選択肢 (単価は720p時の概算)
const MODEL_OPTIONS = VIDEO_MODELS.map((m) => ({
  value: m.value,
  label: m.label,
  price: m.priceHint,
}));

const ASPECTS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

// モデル定義から解像度・長さの選択肢を組み立てる
const resolutionOptions = (def) => def.resolutions ?? ["480p", "720p"];
const durationOptions = (def) => {
  const d = def.durations ?? { auto: true, min: 4, max: 15 };
  const list = [];
  if (d.auto) list.push({ value: "auto", label: "長さ: 自動" });
  for (let s = d.min; s <= d.max; s++) list.push({ value: String(s), label: `${s}秒` });
  return list;
};

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
  const def = VIDEO_MODELS.find((m) => m.value === model) ?? VIDEO_MODELS[0];
  const count = Math.min(data.count ?? 1, MAX_COUNT);
  const videoUrls = data.videoUrls ?? (data.videoUrl ? [data.videoUrl] : []);

  // モデルを切り替えたとき、そのモデルにない解像度/長さは有効な値へ丸める
  const resList = resolutionOptions(def);
  const resolution = resList.includes(data.resolution) ? data.resolution : (resList.includes("720p") ? "720p" : resList[0]);
  const durList = durationOptions(def);
  const duration = durList.some((d) => d.value === (data.duration ?? "auto"))
    ? (data.duration ?? "auto")
    : String(def.durations?.default ?? durList[0].value);

  // 実行前のコスト概算 (設定が変わるたびに再計算)
  const rate = useUsdJpy();
  const estUsd = estimateVideoUsd({ model, resolution, duration, count });

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

  // 接続中の参照/開始/終了画像 (表示用)
  const linked = JSON.parse(
    useStore((s) => {
      let refCount = 0;
      let hasStart = false;
      let hasEnd = false;
      for (const e of s.edges) {
        if (e.target !== id) continue;
        const src = s.nodeLookup.get(e.source);
        if (!src) continue;
        const isImg =
          (src.type === "imageInput" && src.data?.image) ||
          (src.type === "generate" && src.data?.results?.length);
        if (!isImg) continue;
        if (e.targetHandle === "startImage") hasStart = true;
        else if (e.targetHandle === "endImage") hasEnd = true;
        else refCount += src.type === "generate" ? src.data.results.length : 1;
      }
      return JSON.stringify({ refCount, hasStart, hasEnd });
    })
  );

  const collectInputs = useCallback(() => {
    const nodes = getNodes();
    const edges = getEdges();
    const incoming = edges.filter((e) => e.target === id);

    const prompts = [];
    const images = []; // 参照画像 (複数可)
    let startImage = null;
    let endImage = null;
    for (const edge of incoming) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src) continue;
      if (src.type === "prompt" && src.data.text?.trim()) {
        prompts.push(src.data.text.trim());
        continue;
      }
      // 画像系: つないだハンドルで 参照/開始/終了 を振り分ける
      const first =
        src.type === "imageInput" ? src.data.image
        : src.type === "generate" && src.data.results?.length ? src.data.results[0]
        : null;
      if (!first) continue;
      if (edge.targetHandle === "startImage") startImage = first;
      else if (edge.targetHandle === "endImage") endImage = first;
      else if (src.type === "generate") images.push(...src.data.results);
      else images.push(first);
    }
    if (data.prompt?.trim()) prompts.push(data.prompt.trim());
    return { prompt: prompts.join("\n"), images, startImage, endImage };
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
    const { prompt, images, startImage, endImage } = collectInputs();
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

    // ループON: 終了画像が未接続なら開始画像を終了フレームにも使う
    const effectiveEnd = endImage ?? (data.loop && startImage ? startImage : null);

    try {
      const urls = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          generateVideo({
            model,
            prompt,
            images,
            startImage,
            endImage: effectiveEnd,
            resolution,
            duration,
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
            // 使用額トラッカーに積算 (実際の動画の長さを測って秒単価×秒数で概算)
            const meta = await probeVideoMeta(url).catch(() => null);
            const sec =
              meta?.duration ||
              (duration === "auto" ? VIDEO_AUTO_DURATION : Number(duration) || VIDEO_AUTO_DURATION);
            const per = def.perSecond?.[resolution] ?? def.perSecond?.["720p"] ?? 0;
            recordUsage({ model: def.label, usd: per * sec });
            return url;
          })
        )
      );
      updateNodeData(id, { videoUrls: urls, videoUrl: null, loading: false, status: null, error: null });
    } catch (err) {
      updateNodeData(id, { loading: false, status: null, error: err.message });
    }
  }, [id, model, count, resolution, duration, data.uid, data.aspect, data.audio, data.loop, collectInputs, ensureJobGrid, updateNodeData]);

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
        title="参照画像をつなぐ (雰囲気やキャラの参照。最大9枚)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 15l-5-5-9 9" />
        </svg>
      </Handle>
      {/* 左上: 開始/終了フレームの指定 (青系) */}
      <Handle
        id="startImage"
        type="target"
        position={Position.Left}
        className="io-handle io-handle-frame io-handle-left io-target-start"
        isValidConnection={acceptImage}
        title="開始画像をつなぐ (最初のフレームになる)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6v12l10-6z" />
        </svg>
      </Handle>
      <Handle
        id="endImage"
        type="target"
        position={Position.Left}
        className="io-handle io-handle-frame io-handle-left io-target-endimg"
        isValidConnection={acceptImage}
        title="終了画像をつなぐ (最後のフレームになる。開始画像とセットで使う)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 6v12l8-6z" />
          <path d="M18 6v12" />
        </svg>
      </Handle>

      <div className="node-header">
        <span className="node-dot dot-video" />
        動画 #{idNum(id)}
        <ModelSelect
          value={model}
          options={MODEL_OPTIONS}
          onChange={(m) => updateNodeData(id, { model: m })}
          title="動画モデルを切り替える (単価は720p時の概算)"
        />
      </div>

      {(linked.refCount > 0 || linked.hasStart || linked.hasEnd) && (
        <div className="ref-chips">
          {linked.hasStart && <span className="ref-chip">開始画像</span>}
          {linked.hasEnd && <span className="ref-chip">終了画像</span>}
          {linked.refCount > 0 && <span className="ref-chip">参照画像 ×{linked.refCount}</span>}
        </div>
      )}

      <textarea
        className="nodrag nowheel gen-prompt-textarea"
        placeholder={"動きやカメラワークも含めて入力…\n(プロンプトノードをつないだ場合は内容が結合されます)"}
        value={data.prompt ?? ""}
        onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
      />

      {/* ステータスのみ表示。結果の閲覧・保存はジョブグリッド側に一本化 */}
      {data.loading ? (
        <div className="video-result nodrag">
          <div className="video-progress">
            <span className="spinner" />
            <span>{data.status || "生成中…"}</span>
            <span className="video-elapsed">{fmtElapsed}</span>
          </div>
        </div>
      ) : videoUrls.length > 0 ? (
        <div className="video-done" title="結果の再生・保存はジョブグリッドか履歴から">
          ✓ {videoUrls.length}本 完了 — 結果はジョブグリッドへ
        </div>
      ) : null}

      {data.error && <div className="error-box">{data.error}</div>}

      <div className="param-row nodrag">
        <select
          value={resolution}
          onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
          title={def.noEndAt360 ? "360pは終了画像・ループと併用できません" : undefined}
        >
          {resList.map((r) => (
            <option key={r} value={r}>解像度: {r}</option>
          ))}
        </select>
        <select
          value={duration}
          onChange={(e) => updateNodeData(id, { duration: e.target.value })}
        >
          {durList.map((d) => (
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
        <label
          className="audio-toggle"
          title="開始画像を終了フレームにも使い、最初と最後がつながるループ動画にする (開始画像の接続が必要)"
        >
          <input
            type="checkbox"
            checked={data.loop ?? false}
            onChange={(e) => updateNodeData(id, { loop: e.target.checked })}
          />
          ループ
        </label>
      </div>

      <div
        className="video-cost-note"
        title={`概算です。実際の請求はUSD建て (約$${estUsd.toFixed(2)}) で、為替レートにより変動します。「長さ: 自動」は${VIDEO_AUTO_DURATION}秒として計算しています`}
      >
        予想コスト <span className="cost-yen">{fmtJpy(estUsd, rate)}</span>
        ・動画は画像より高コストです
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
