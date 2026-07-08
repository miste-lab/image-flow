// fal.ai をブラウザから直接叩くクライアント (BYOK)。
// すべて queue.fal.run のキューAPI経由: 送信 → ステータスをポーリング → 結果取得。
// キーは api.js の getFalKey (このブラウザ内にのみ保存、送信先は fal.run のみ)。

import { getFalKey } from "./api.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// キューのステータスをノード表示用の日本語にする
// IN_QUEUE = まだ順番待ち / IN_PROGRESS = 実際に生成が始まっている
export function queueStatusLabel(st) {
  if (st?.status === "IN_QUEUE") {
    return st.queue_position != null
      ? `順番待ち (${st.queue_position + 1}番目)`
      : "順番待ち…";
  }
  return "生成中…";
}

function falErrorMessage(data, status) {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  if (data?.error) return String(data.error);
  return `fal.ai APIエラー (HTTP ${status})`;
}

// キューに投げて完了までポーリングする共通処理。
// onStatus には {status: "IN_QUEUE"|"IN_PROGRESS", queue_position?} が渡る
async function falQueueRun(modelId, input, { onStatus, pollMs = 3000 } = {}) {
  const key = getFalKey();
  if (!key) {
    throw new Error("fal.aiのAPIキーが未設定です。右上の「APIキー」から設定してください。");
  }
  const headers = { Authorization: `Key ${key}` };

  const submitRes = await fetch(`https://queue.fal.run/${modelId}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const submitted = await submitRes.json().catch(() => ({}));
  if (!submitRes.ok) throw new Error(falErrorMessage(submitted, submitRes.status));

  // ステータス/結果のURLはレスポンスのものをそのまま使う
  // (サブパス付きモデルIDはURLの組み立て規則が異なるため自前で作らない)
  const statusUrl = submitted.status_url;
  const responseUrl = submitted.response_url;

  for (;;) {
    await sleep(pollMs);
    const stRes = await fetch(statusUrl, { headers });
    const st = await stRes.json().catch(() => ({}));
    if (!stRes.ok) throw new Error(falErrorMessage(st, stRes.status));
    if (st.status === "COMPLETED") break;
    onStatus?.(st);
  }

  const res = await fetch(responseUrl, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(falErrorMessage(data, res.status));
  return data;
}

// URLで返ってきたメディアを dataURL に取り込む (履歴・チェーン用)
async function toDataUrl(url) {
  if (url.startsWith("data:")) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/* ---------- 画像生成: Seedream 5.0 Lite ---------- */

// prompt / images(dataURL配列) / size("WxH"|"auto") / resolution / n → dataURL配列。
// 画像入力があれば edit、なければ text-to-image
export async function generateImagesSeedream({ prompt, images = [], size, resolution, n = 1 }) {
  // Seedreamのカスタムサイズは最低約370万px。比率プリセット(≒1MP)は2倍して2Kクラスにする
  let image_size;
  if (!size || size === "auto") {
    image_size =
      resolution === "4k" ? "auto_4K" : resolution === "2k" ? "auto_3K" : "auto_2K";
  } else {
    const [w, h] = size.split("x").map(Number);
    image_size = { width: w * 2, height: h * 2 };
  }

  const input = {
    prompt,
    image_size,
    num_images: n,
    sync_mode: true, // 結果を dataURI で受け取る (URLの再取得が不要)
    enable_safety_checker: true,
  };
  let endpoint = "fal-ai/bytedance/seedream/v5/lite/text-to-image";
  if (images.length > 0) {
    endpoint = "fal-ai/bytedance/seedream/v5/lite/edit";
    input.image_urls = images.slice(0, 10); // 上限10枚
  }

  const data = await falQueueRun(endpoint, input, { pollMs: 1500 });
  const list = (data?.images || []).map((im) => im?.url).filter(Boolean);
  if (list.length === 0) throw new Error("fal.aiから画像データが返りませんでした。");
  return Promise.all(list.map(toDataUrl));
}

/* ---------- 動画生成: Seedance 2.0 ---------- */

// model / prompt / images / resolution / duration / aspectRatio / audio → 動画URL。
// 進捗は onStatus で通知される
export async function generateVideoSeedance({
  model = "standard",
  prompt,
  images = [],
  endImage = null,
  resolution = "720p",
  duration = "auto",
  aspectRatio = "auto",
  audio = true,
  onStatus,
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error("プロンプトが空です。ノード内の入力欄に書くか、プロンプトノードを接続してください。");
  }
  if (endImage && images.length === 0) {
    throw new Error("終了画像を使うには開始画像もつないでください。");
  }
  if (endImage && model === "mini") {
    throw new Error("Seedance 2.0 Mini は終了画像に対応していません。standard か fast を選んでください。");
  }

  const input = { prompt, resolution, generate_audio: audio };
  if (duration && duration !== "auto") input.duration = String(duration);
  // 画像入力があるときは画像の比率が優先されるので aspect_ratio は送らない
  if (aspectRatio && aspectRatio !== "auto" && images.length === 0) {
    input.aspect_ratio = aspectRatio;
  }

  // Mini は reference-to-video のみ提供。standard/fast は入力に応じて振り分ける
  let endpoint;
  if (model === "mini") {
    endpoint = "bytedance/seedance-2.0/mini/reference-to-video";
    if (images.length > 0) input.image_urls = images.slice(0, 9);
  } else {
    const base =
      model === "fast" ? "bytedance/seedance-2.0/fast" : "bytedance/seedance-2.0";
    if (images.length === 0) {
      endpoint = `${base}/text-to-video`;
    } else if (images.length === 1 || endImage) {
      // 終了画像は image-to-video でのみ指定できる (開始画像は先頭の1枚)
      endpoint = `${base}/image-to-video`;
      input.image_url = images[0];
      if (endImage) input.end_image_url = endImage;
    } else {
      endpoint = `${base}/reference-to-video`;
      input.image_urls = images.slice(0, 9);
    }
  }

  const data = await falQueueRun(endpoint, input, { onStatus, pollMs: 3000 });
  const url = data?.video?.url;
  if (!url) throw new Error("fal.aiから動画データが返りませんでした。");
  return url;
}

/* ---------- 動画アップスケール: Topaz / SeedVR2 ---------- */

// 動画のメタデータから縦解像度を調べる (Topazの倍率計算用)
function probeVideoHeight(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => resolve(v.videoHeight || 0);
    v.onerror = () => resolve(0);
    v.src = url;
  });
}

// videoUrl を指定解像度にアップスケールして動画URLを返す。
// Topaz は倍率指定なので元動画の高さから倍率を計算する。SeedVR2 は解像度を直接指定できる
export async function upscaleVideo({
  model = "topaz",
  videoUrl,
  resolution = "1080p",
  fps = "30",
  onStatus,
}) {
  if (!videoUrl) {
    throw new Error("入力動画がありません。動画生成ノードの出力をつないで、先に動画を生成してください。");
  }

  let endpoint;
  let input;
  if (model === "seedvr") {
    endpoint = "fal-ai/seedvr/upscale/video";
    input = {
      video_url: videoUrl,
      upscale_mode: "target",
      target_resolution: resolution, // 720p/1080p/1440p/2160p
    };
    // SeedVR2 にフレームレート指定はない (fpsは元動画のまま)
  } else {
    endpoint = "fal-ai/topaz/upscale/video";
    const srcH = await probeVideoHeight(videoUrl);
    const targetH = { "1080p": 1080, "1440p": 1440, "2160p": 2160 }[resolution] ?? 1080;
    const factor = Math.min(8, Math.max(1, targetH / (srcH || 720)));
    input = {
      video_url: videoUrl,
      upscale_factor: Math.round(factor * 100) / 100,
      target_fps: Number(fps) || 30,
      H264_output: true, // H265はブラウザで再生できないことがある
    };
  }

  const data = await falQueueRun(endpoint, input, { onStatus, pollMs: 3000 });
  const url = data?.video?.url;
  if (!url) throw new Error("fal.aiから動画データが返りませんでした。");
  return url;
}
