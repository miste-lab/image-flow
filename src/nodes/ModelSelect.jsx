import React, { useEffect, useRef, useState } from "react";

// モデル切替ドロップダウン。各選択肢に概算単価を小さく添える。
// options: [{ value, label, price }]
export default function ModelSelect({ value, options, onChange, title }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const current = options.find((o) => o.value === value) || options[0];

  return (
    <div className="model-select nodrag" ref={rootRef}>
      <button
        className="model-select-btn"
        title={title || "モデルを切り替える"}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="model-select-label">{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="model-select-pop">
          {options.map((o) => (
            <button
              key={o.value}
              className={`model-option ${o.value === value ? "on" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="model-option-name">{o.label}</span>
              <span className="model-option-price">{o.price}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
