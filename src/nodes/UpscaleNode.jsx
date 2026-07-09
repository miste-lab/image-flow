import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore } from "@xyflow/react";
import ModelSelect from "./ModelSelect.jsx";
import { upscaleVideo, queueStatusLabel, probeVideoMeta } from "../fal.js";
import { UPSCALE_MODELS, estimateUpscaleUsd, useUsdJpy, fmtJpy, VIDEO_AUTO_DURATION } from "../pricing.js";

// モデル定義 (pricing.js) → ドロップダウンの選択肢
const MODEL_OPTIONS = UPSCALE_MODELS.map((m) => ({
  value: m.value,
  label: m.label,
  price: m.priceHint,
}));

const RESOLUTIONS = ["1080p", "1440p", "2160p"];
const FPS_OPTIONS = ["24", "30", "60"];

const idNum = (nodeId) => (String(nodeId).match(/(\d+)$/) || [])[1] || "?";

// 動画アップスケールノード。動画生成ノードの出力をつないで高解像度化する
export default function UpscaleNode({ id, data }) {
  const { updateNodeData, getNodes, getEdges, getNode } = useReactFlow();

  const acceptVideo = useCallback(
    (conn) => getNode(conn.source)?.type === "videoGen",
    [getNode]
  );

  const model = data.model ?? "topaz";

  // 経過時間表示
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

  // 接続中の動画生成ノードの動画URL (表示・概算用)
  const sourceUrl = useStore((s) => {
    for (const e of s.edges) {
      if (e.target !== id) continue;
      const src = s.nodeLookup.get(e.source);
      if (src?.type !== "videoGen") continue;
      const urls = src.data?.videoUrls ?? (src.data?.videoUrl ? [src.data.videoUrl] : []);
      if (urls.length > 0) return urls[0];
    }
    return null;
  });
  const sourceReady = !!sourceUrl;

  // 入力動画の長さをメタデータから調べてコスト概算に使う
  const [srcMeta, setSrcMeta] = useState(null);
  useEffect(() => {
    if (!sourceUrl) {
      setSrcMeta(null);
      return;
    }
    let alive = true;
    probeVideoMeta(sourceUrl).then((m) => alive && setSrcMeta(m));
    return () => {
      alive = false;
    };
  }, [sourceUrl]);

  const rate = useUsdJpy();
  const estUsd = estimateUpscaleUsd({
    model,
    resolution: data.resolution ?? "1080p",
    fps: data.fps ?? "30",
    durationSec: srcMeta?.duration || 0,
  });

  // つないだ動画生成ノードから入力動画を取る (最初の1本)
  const collectVideo = useCallback(() => {
    const nodes = getNodes();
    for (const e of getEdges()) {
      if (e.target !== id) continue;
      const src = nodes.find((n) => n.id === e.source);
      if (src?.type !== "videoGen") continue;
      const urls = src.data?.videoUrls ?? (src.data?.videoUrl ? [src.data.videoUrl] : []);
      if (urls.length > 0) return urls[0];
    }
    return null;
  }, [id, getNodes, getEdges]);

  const run = useCallback(async () => {
    const videoUrl = collectVideo();
    updateNodeData(id, { loading: true, status: "送信中…", error: null });
    try {
      const url = await upscaleVideo({
        model,
        videoUrl,
        resolution: data.resolution ?? "1080p",
        fps: data.fps ?? "30",
        onStatus: (st) => updateNodeData(id, { status: queueStatusLabel(st) }),
      });
      updateNodeData(id, { videoUrl: url, loading: false, status: null, error: null });
    } catch (err) {
      updateNodeData(id, { loading: false, status: null, error: err.message });
    }
  }, [id, model, data.resolution, data.fps, collectVideo, updateNodeData]);

  const save = async () => {
    if (!data.videoUrl) return;
    const blob = await (await fetch(data.videoUrl)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `image-flow-upscaled-${Date.now()}.mp4`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="node node-upscale">
      <Handle
        id="video"
        type="target"
        position={Position.Left}
        className="io-handle io-handle-image io-handle-left io-target-video"
        isValidConnection={acceptVideo}
        title="動画生成ノードの出力をつなぐ"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9.5v5l4.5-2.5z" />
        </svg>
      </Handle>

      <div className="node-header">
        <span className="node-dot dot-upscale" />
        動画アップスケール #{idNum(id)}
        <ModelSelect
          value={model}
          options={MODEL_OPTIONS}
          onChange={(m) => updateNodeData(id, { model: m })}
          title="アップスケールモデルを切り替える"
        />
      </div>

      {!sourceReady && !data.loading && !data.videoUrl && (
        <div className="upscale-hint">
          動画生成ノードの出力をつなぎ、
          <br />
          先に動画を生成してください
        </div>
      )}

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
          value={data.resolution ?? "1080p"}
          onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>出力: {r}</option>
          ))}
        </select>
        <select
          value={data.fps ?? "30"}
          onChange={(e) => updateNodeData(id, { fps: e.target.value })}
          disabled={model === "seedvr"}
          title={model === "seedvr" ? "フレームレート指定は Topaz のみ (SeedVR2は元動画のまま)" : "フレーム補間で滑らかにする"}
        >
          {FPS_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}fps</option>
          ))}
        </select>
      </div>

      <div
        className="video-cost-note"
        title={`概算です。実際の請求はUSD建て (約$${estUsd.toFixed(2)}) で、為替レートにより変動します。${srcMeta?.duration ? `入力動画 約${Math.round(srcMeta.duration)}秒で計算` : `入力動画が未生成のため${VIDEO_AUTO_DURATION}秒として計算`}`}
      >
        予想コスト <span className="cost-yen">{fmtJpy(estUsd, rate)}</span>
        {model === "topaz" && (data.fps ?? "30") === "60" && " (60fpsで約2倍)"}
      </div>

      <div className="action-row nodrag">
        <button className="run-btn" onClick={run} disabled={data.loading}>
          {data.loading ? "処理中…" : "高解像度化"}
        </button>
      </div>
    </div>
  );
}
