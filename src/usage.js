// 自前の使用額トラッカー (概算)。
// ジョブ完了のたびに recordUsage で USD額を localStorage に日別・モデル別で積算する。
// あくまで単価表からの概算で、実際の請求とはズレることがある。

const KEY = "usage_tracker"; // { days: { "YYYY-MM-DD": { total, models: { モデル名: usd } } } }

const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { days: {} };
  } catch {
    return { days: {} };
  }
}

export function recordUsage({ model, usd }) {
  if (!usd || !(usd > 0)) return;
  const data = load();
  const k = dayKey();
  const day = (data.days[k] = data.days[k] || { total: 0, models: {} });
  day.total += usd;
  day.models[model] = (day.models[model] || 0) + usd;
  localStorage.setItem(KEY, JSON.stringify(data));
  window.dispatchEvent(new Event("usage-changed"));
}

// 今日・今月の合計と、今月のモデル別内訳 (すべてUSD)
export function getUsageSummary() {
  const data = load();
  const today = dayKey();
  const month = today.slice(0, 7);
  let todayUsd = 0;
  let monthUsd = 0;
  const models = {};
  for (const [k, day] of Object.entries(data.days)) {
    if (!k.startsWith(month)) continue;
    monthUsd += day.total || 0;
    if (k === today) todayUsd += day.total || 0;
    for (const [m, v] of Object.entries(day.models || {})) {
      models[m] = (models[m] || 0) + v;
    }
  }
  return { todayUsd, monthUsd, models };
}

export function resetUsage() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("usage-changed"));
}
