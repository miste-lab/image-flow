// fal.ai をブラウザから直接叩くクライアント (BYOK)。
// すべて queue.fal.run のキューAPI経由: 送信 → ステータスをポーリング → 結果取得。
// キーは api.js の getFalKey (このブラウザ内にのみ保存、送信先は fal.run のみ)。

import { getFalKey } from "./api.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  resolution = "720p",
  duration = "auto",
  aspectRatio = "auto",
  audio = true,
  onStatus,
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error("プロンプトが空です。ノード内の入力欄に書くか、プロンプトノードを接続してください。");
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
    } else if (images.length === 1) {
      endpoint = `${base}/image-to-video`;
      input.image_url = images[0];
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
