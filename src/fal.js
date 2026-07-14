// fal.ai をブラウザから直接叩くクライアント (BYOK)。
// すべて queue.fal.run のキューAPI経由: 送信 → ステータスをポーリング → 結果取得。
// キーは api.js の getFalKey (このブラウザ内にのみ保存、送信先は fal.run のみ)。

import { getFalKey } from "./api.js";
import { IMAGE_MODELS, VIDEO_MODELS } from "./pricing.js";

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

/* ---------- アカウント残高 ---------- */

// falのクレジット残高 (USD) を取得する。
// ADMINスコープのキーが必要で、通常のAPIキーだと401/403になる → その場合は null を返し、
// 呼び出し側は表示ごと隠す (CORSは開放されていることを確認済み)
export async function getFalBalance() {
  const key = getFalKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
      headers: { Authorization: `Key ${key}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const balance = data?.credits?.current_balance;
    return typeof balance === "number" ? balance : null;
  } catch {
    return null;
  }
}

/* ---------- 画像生成: Seedream (Lite / Pro) ---------- */

// model(IMAGE_MODELSのvalue) / prompt / images(dataURL配列) / size / resolution / n → dataURL配列。
// 画像入力があれば edit、なければ text-to-image
export async function generateImagesSeedream({ model = "seedream-lite", prompt, images = [], size, resolution, n = 1 }) {
  const def =
    IMAGE_MODELS.find((m) => m.value === model && m.provider === "fal") ??
    IMAGE_MODELS.find((m) => m.value === "seedream-lite");
  // Seedreamのカスタムサイズは最低約370万px。比率プリセット(≒1MP)は2倍して2Kクラスにする
  let image_size;
  if (!size || size === "auto") {
    image_size =
      resolution === "4k" ? "auto_4K" : resolution === "2k" ? "auto_3K" : "auto_2K";
    if (def.autoMax2K) image_size = "auto_2K"; // モデルが対応する上限に丸める
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
  let endpoint = def.endpoints.t2i;
  if (images.length > 0) {
    endpoint = def.endpoints.edit;
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
// images = 参照画像 (雰囲気やキャラを参照)。startImage/endImage = 最初/最後のフレーム指定。
// モデルの family (seedance / vidu) ごとにAPIの流儀を吸収する
export async function generateVideo({
  model = "standard",
  prompt,
  images = [],
  startImage = null,
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
  if (endImage && !startImage) {
    throw new Error("終了画像を使うには開始画像もつないでください (ループは開始画像だけでOK)。");
  }
  if (startImage && images.length > 0) {
    throw new Error("開始画像と参照画像は同時に使えません。どちらか一方をつないでください。");
  }
  const def = VIDEO_MODELS.find((m) => m.value === model) ?? VIDEO_MODELS[0];

  let endpoint;
  let input;

  if (def.family === "vidu") {
    /* ---- Vidu Q3 / Q3 Turbo ---- */
    if (images.length > 1) {
      throw new Error(`${def.label} は参照画像を1枚しか使えません。複数の参照はSeedanceを選んでください。`);
    }
    if (endImage && def.noEndAt360 && resolution === "360p") {
      throw new Error("360pでは終了画像(ループ含む)を使えません。540p以上を選んでください。");
    }
    input = {
      prompt,
      resolution,
      audio,
      duration:
        duration === "auto"
          ? def.durations.default ?? 5
          : Math.min(def.durations.max, Math.max(def.durations.min, Number(duration) || 5)),
    };
    const start = startImage || images[0] || null;
    if (start) {
      endpoint = def.endpoints.i2v;
      input.image_url = start;
      if (endImage) input.end_image_url = endImage;
    } else {
      endpoint = def.endpoints.t2v;
      if (aspectRatio !== "auto" && def.aspects?.includes(aspectRatio)) {
        input.aspect_ratio = aspectRatio;
      }
    }
  } else {
    /* ---- Seedance 2.0 (standard / fast / mini) ---- */
    if (endImage && def.referenceOnly) {
      throw new Error(`${def.label} は終了画像に対応していません。standard か fast を選んでください。`);
    }
    const hasAnyImage = !!startImage || images.length > 0;
    input = { prompt, resolution, generate_audio: audio };
    if (duration && duration !== "auto") input.duration = String(duration);
    // 画像入力があるときは画像の比率が優先されるので aspect_ratio は送らない
    if (aspectRatio && aspectRatio !== "auto" && !hasAnyImage) {
      input.aspect_ratio = aspectRatio;
    }

    // referenceOnly(Mini)は常に reference-to-video。他は入力に応じて振り分ける
    if (def.referenceOnly) {
      endpoint = `${def.base}/reference-to-video`;
      const refs = startImage ? [startImage] : images;
      if (refs.length > 0) input.image_urls = refs.slice(0, 9);
    } else {
      const base = def.base;
      if (startImage) {
        // 開始(+終了)フレーム指定 → image-to-video
        endpoint = `${base}/image-to-video`;
        input.image_url = startImage;
        if (endImage) input.end_image_url = endImage;
      } else if (images.length === 0) {
        endpoint = `${base}/text-to-video`;
      } else if (images.length === 1) {
        endpoint = `${base}/image-to-video`;
        input.image_url = images[0];
      } else {
        endpoint = `${base}/reference-to-video`;
        input.image_urls = images.slice(0, 9);
      }
    }
  }

  const data = await falQueueRun(endpoint, input, { onStatus, pollMs: 3000 });
  const url = data?.video?.url;
  if (!url) throw new Error("fal.aiから動画データが返りませんでした。");
  return url;
}

/* ---------- 動画アップスケール: Topaz / SeedVR2 ---------- */

// 動画のメタデータ (縦解像度・長さ) を調べる。倍率計算とコスト概算に使う
export function probeVideoMeta(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () =>
      resolve({ height: v.videoHeight || 0, duration: v.duration || 0 });
    v.onerror = () => resolve({ height: 0, duration: 0 });
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
    const { height: srcH } = await probeVideoMeta(videoUrl);
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
