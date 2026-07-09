// 生成コストの概算 (単価テーブル + 為替)。
// ★ 料金改定のときはこのファイルの数値だけ直せばよい ★
// 表示はあくまで概算。実際の請求は各サービスのUSD建てで、為替により変動する。

import { useEffect, useState } from "react";

/* ---------- モデル定義 + 単価テーブル (USD) ----------
   新しいモデルが出たら、下の配列にエントリを1つ足すだけで
   ノードのドロップダウンに出て、コスト概算も効くようになる。 */

// 画像モデル。provider: "openai" は api.js、"fal" は fal.js (endpoints必須) を使う
export const IMAGE_MODELS = [
  {
    value: "gpt-image-2",
    label: "gpt-image-2",
    provider: "openai",
    priceHint: "$0.006〜0.21/枚",
  },
  {
    value: "seedream-lite",
    label: "Seedream 5.0 Lite",
    provider: "fal",
    priceHint: "$0.035/枚",
    perImage: 0.035, // 解像度によらず固定
    endpoints: {
      t2i: "fal-ai/bytedance/seedream/v5/lite/text-to-image",
      edit: "fal-ai/bytedance/seedream/v5/lite/edit",
    },
  },
  {
    value: "seedream-pro",
    label: "Seedream 5.0 Pro",
    provider: "fal",
    priceHint: "$0.0675/枚",
    perImage: 0.0675,
    autoMax2K: true, // Proのautoプリセットは auto_2K まで (auto_3K/4Kなし)
    endpoints: {
      t2i: "bytedance/seedream/v5/pro/text-to-image",
      edit: "bytedance/seedream/v5/pro/edit",
    },
  },
];

// gpt-image-2 の品質別単価 (1024×1024基準)
export const GPT_IMAGE_PRICING = { low: 0.006, medium: 0.053, high: 0.211, auto: 0.053 };

// 動画モデル (fal)。base + /text-to-video 等でエンドポイントになる。
// referenceOnly: true は reference-to-video しか提供されないモデル (Mini)。
// 480pの standard/fast は公表値がないため、720p単価×面積比(約0.44)からの推定値。
// ★ Seedance 2.5 がリリースされたら、ここにエントリを足すだけでよい ★
export const VIDEO_MODELS = [
  {
    value: "standard",
    label: "Seedance 2.0",
    priceHint: "約$0.30/秒",
    base: "bytedance/seedance-2.0",
    perSecond: { "480p": 0.135, "720p": 0.3034 },
  },
  {
    value: "fast",
    label: "Seedance 2.0 Fast",
    priceHint: "約$0.24/秒",
    base: "bytedance/seedance-2.0/fast",
    perSecond: { "480p": 0.108, "720p": 0.2419 },
  },
  {
    value: "mini",
    label: "Seedance 2.0 Mini",
    priceHint: "約$0.15/秒",
    base: "bytedance/seedance-2.0/mini",
    referenceOnly: true,
    perSecond: { "480p": 0.0721, "720p": 0.1547 },
  },
];

// 動画アップスケールモデル
export const UPSCALE_MODELS = [
  { value: "topaz", label: "Topaz Video AI", priceHint: "$0.01〜0.08/秒" },
  { value: "seedvr", label: "SeedVR2 (AI動画向け)", priceHint: "$0.001/百万px" },
];

// 「長さ: 自動」のときに見積もりに使う想定秒数
export const VIDEO_AUTO_DURATION = 5;

// アップスケール
export const UPSCALE_PRICING = {
  // Topaz: 出力1秒あたり (ユーザー提供の概算)。60fps指定でおよそ2倍
  topaz: { "1080p": 0.02, "1440p": 0.04, "2160p": 0.08, fps60Multiplier: 2 },
  // SeedVR2: 出力の 幅×高さ×フレーム数 100万pxあたり
  seedvrPerMegapixel: 0.001,
};

/* ---------- 見積もり計算 ---------- */

export function estimateImageUsd({ model, quality = "auto", resolution = "auto", count = 1 }) {
  const def = IMAGE_MODELS.find((m) => m.value === model);
  if (def?.perImage) return def.perImage * count; // fal系は枚数固定単価
  const base = GPT_IMAGE_PRICING[quality] ?? GPT_IMAGE_PRICING.auto;
  // gpt-image-2 の料金はおよそピクセル数に比例するので、解像度倍率の2乗を掛ける
  const mult = resolution === "4k" ? 16 : resolution === "2k" ? 4 : 1;
  return base * mult * count;
}

export function estimateVideoUsd({ model, resolution = "720p", duration = "auto", count = 1 }) {
  const def = VIDEO_MODELS.find((m) => m.value === model) ?? VIDEO_MODELS[0];
  const per = def.perSecond?.[resolution] ?? def.perSecond?.["720p"] ?? 0.3;
  const sec = duration === "auto" ? VIDEO_AUTO_DURATION : Number(duration) || VIDEO_AUTO_DURATION;
  return per * sec * count;
}

const OUT_DIMS = {
  "1080p": [1920, 1080],
  "1440p": [2560, 1440],
  "2160p": [3840, 2160],
};

export function estimateUpscaleUsd({ model, resolution = "1080p", fps = "30", durationSec, srcFps }) {
  const sec = durationSec || VIDEO_AUTO_DURATION;
  if (model === "seedvr") {
    const [w, h] = OUT_DIMS[resolution] ?? OUT_DIMS["1080p"];
    const frames = (srcFps || 30) * sec;
    return ((w * h * frames) / 1e6) * UPSCALE_PRICING.seedvrPerMegapixel;
  }
  const per = UPSCALE_PRICING.topaz[resolution] ?? UPSCALE_PRICING.topaz["1080p"];
  return per * sec * (String(fps) === "60" ? UPSCALE_PRICING.topaz.fps60Multiplier : 1);
}

/* ---------- 為替 (USD/JPY) ---------- */
// Frankfurter API から1日1回取得して localStorage にキャッシュ。
// 取得失敗時は キャッシュ値 → 固定値155円 の順でフォールバック

const RATE_KEY = "usd_jpy_rate";
const FALLBACK_RATE = 155;
const ONE_DAY = 24 * 60 * 60 * 1000;

function cachedRate() {
  try {
    return JSON.parse(localStorage.getItem(RATE_KEY));
  } catch {
    return null;
  }
}

export async function getUsdJpy() {
  const cached = cachedRate();
  if (cached?.rate && Date.now() - cached.ts < ONE_DAY) return cached.rate;
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY");
    const data = await res.json();
    const rate = data?.rates?.JPY;
    if (rate) {
      localStorage.setItem(RATE_KEY, JSON.stringify({ rate, ts: Date.now() }));
      return rate;
    }
  } catch {
    /* オフライン等 → フォールバックへ */
  }
  return cached?.rate ?? FALLBACK_RATE;
}

// コンポーネント用フック。まずキャッシュ/固定値で即表示し、取得できたら更新する
export function useUsdJpy() {
  const [rate, setRate] = useState(() => cachedRate()?.rate ?? FALLBACK_RATE);
  useEffect(() => {
    let alive = true;
    getUsdJpy().then((r) => alive && setRate(r));
    return () => {
      alive = false;
    };
  }, []);
  return rate;
}

export const fmtJpy = (usd, rate) =>
  `約¥${Math.max(1, Math.round(usd * rate)).toLocaleString()}`;
