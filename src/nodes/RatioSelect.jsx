import React, { useEffect, useRef, useState } from "react";

// gpt-image-2 の制約(16の倍数・最小総ピクセル数)を満たすプリセット
export const RATIOS = [
  { value: "auto",      ratio: "auto", label: "自動",            w: 1,    h: 1 },
  { value: "1024x1024", ratio: "1:1",  label: "Square",          w: 1024, h: 1024 },
  { value: "1536x864",  ratio: "16:9", label: "Widescreen",      w: 1536, h: 864 },
  { value: "864x1536",  ratio: "9:16", label: "Social story",    w: 864,  h: 1536 },
  { value: "1280x960",  ratio: "4:3",  label: "Classic",         w: 1280, h: 960 },
  { value: "960x1280",  ratio: "3:4",  label: "Traditional",     w: 960,  h: 1280 },
  { value: "1344x896",  ratio: "3:2",  label: "Landscape",       w: 1344, h: 896 },
  { value: "896x1344",  ratio: "2:3",  label: "Portrait",        w: 896,  h: 1344 },
  { value: "1280x1024", ratio: "5:4",  label: "Large format",    w: 1280, h: 1024 },
  { value: "1024x1280", ratio: "4:5",  label: "Social portrait", w: 1024, h: 1280 },
  { value: "2016x864",  ratio: "21:9", label: "Ultrawide",       w: 2016, h: 864 },
  { value: "2400x800",  ratio: "3:1",  label: "Panorama",        w: 2400, h: 800 },
  { value: "800x2400",  ratio: "1:3",  label: "Tall panorama",   w: 800,  h: 2400 },
];

// 比率を表す小さな枠アイコン
function RatioIcon({ w, h, auto }) {
  if (auto) return <span className="ratio-icon ratio-icon-auto">＋</span>;
  const max = 14;
  const scale = max / Math.max(w, h);
  return (
    <span className="ratio-icon">
      <span
        className="ratio-icon-box"
        style={{ width: Math.max(4, w * scale), height: Math.max(4, h * scale) }}
      />
    </span>
  );
}

export default function RatioSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = RATIOS.find((r) => r.value === value) || RATIOS[0];

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="ratio-select nodrag nowheel" ref={rootRef}>
      <button className="ratio-trigger" onClick={() => setOpen((o) => !o)}>
        <RatioIcon w={current.w} h={current.h} auto={current.value === "auto"} />
        <span className="ratio-value">{current.ratio === "auto" ? "auto" : current.ratio}</span>
        <span className="ratio-label">{current.label}</span>
        <span className="ratio-caret">▾</span>
      </button>

      {open && (
        <div className="ratio-menu">
          {RATIOS.map((r) => (
            <button
              key={r.value}
              className={`ratio-item ${r.value === value ? "active" : ""}`}
              onClick={() => {
                onChange(r.value);
                setOpen(false);
              }}
            >
              <RatioIcon w={r.w} h={r.h} auto={r.value === "auto"} />
              <span className="ratio-value">{r.ratio === "auto" ? "auto" : r.ratio}</span>
              <span className="ratio-label">{r.label}</span>
              {r.value !== "auto" && (
                <span className="ratio-px">{r.w}×{r.h}</span>
              )}
              {r.value === value && <span className="ratio-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
