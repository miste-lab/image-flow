import React, { useEffect, useRef, useState } from "react";
import { getUsageSummary, resetUsage } from "../usage.js";
import { useUsdJpy, fmtJpy } from "../pricing.js";
import { getFalBalance } from "../fal.js";
import { getFalKey } from "../api.js";

// ツールバーの使用額表示。「今日 / 今月」の概算 (¥) と、クリックでモデル別内訳。
// falのクレジット残高も取得できたときだけ表示する (ADMINスコープのキーが必要)
export default function UsagePanel() {
  const [open, setOpen] = useState(false);
  const [sum, setSum] = useState(getUsageSummary);
  const [balance, setBalance] = useState(null);
  const rate = useUsdJpy();
  const rootRef = useRef(null);

  // ジョブ完了 (usage-changed) で再集計
  useEffect(() => {
    const refresh = () => setSum(getUsageSummary());
    window.addEventListener("usage-changed", refresh);
    return () => window.removeEventListener("usage-changed", refresh);
  }, []);

  // 残高: 初回とポップオーバーを開いたときに取得 (失敗したら非表示のまま)
  useEffect(() => {
    if (!getFalKey()) return;
    let alive = true;
    getFalBalance().then((b) => alive && setBalance(b));
    return () => {
      alive = false;
    };
  }, [open]);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const entries = Object.entries(sum.models).sort((a, b) => b[1] - a[1]);

  return (
    <div className="key-panel-root" ref={rootRef}>
      <button
        className="tool-btn usage-btn"
        onClick={() => setOpen((o) => !o)}
        title="今日/今月の概算使用額。クリックでモデル別の内訳"
      >
        {balance != null && (
          <span className="usage-balance">残高 ${balance.toFixed(2)}</span>
        )}
        今日 {fmtJpy(sum.todayUsd, rate)}・月 {fmtJpy(sum.monthUsd, rate)}
      </button>

      {open && (
        <div className="key-popover usage-popover">
          <div className="key-title">使用額の内訳 (今月・概算)</div>

          {balance != null && (
            <div className="usage-row usage-balance-row">
              <span>falクレジット残高</span>
              <span>${balance.toFixed(2)}</span>
            </div>
          )}

          {entries.length === 0 ? (
            <div className="usage-empty">今月の生成記録はまだありません</div>
          ) : (
            entries.map(([m, v]) => (
              <div className="usage-row" key={m}>
                <span>{m}</span>
                <span>{fmtJpy(v, rate)}</span>
              </div>
            ))
          )}

          <div className="usage-row usage-total">
            <span>今日</span>
            <span>{fmtJpy(sum.todayUsd, rate)}</span>
          </div>
          <div className="usage-row usage-total">
            <span>今月合計</span>
            <span>{fmtJpy(sum.monthUsd, rate)}</span>
          </div>

          <div className="key-note">
            単価表からの概算です。実際の請求 (USD建て・為替や実測秒数で変動) とはズレることがあります。
          </div>
          <div className="key-actions">
            <button
              className="mini-btn"
              onClick={() => {
                if (window.confirm("使用額の記録をすべてリセットしますか？")) resetUsage();
              }}
            >
              記録をリセット
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
