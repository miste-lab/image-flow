import React, { useEffect, useRef, useState } from "react";
import { getApiKey, setApiKey, getKeyStorageMode } from "../api.js";

export default function KeyPanel() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(!!getApiKey());
  const rootRef = useRef(null);

  useEffect(() => {
    if (open) setValue(getApiKey());
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

  const save = () => {
    setApiKey(value);
    setSaved(!!value.trim());
    setOpen(false);
  };

  const clear = () => {
    setApiKey("");
    setValue("");
    setSaved(false);
  };

  return (
    <div className="key-panel-root" ref={rootRef}>
      <button
        className={`tool-btn key-btn ${saved ? "key-ok" : "key-missing"}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="key-dot" />
        APIキー{saved ? "" : "を設定"}
      </button>

      {open && (
        <div className="key-popover">
          <div className="key-title">OpenAI APIキー</div>
          <input
            type="password"
            className="key-input"
            placeholder="sk-..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
          />
          <div className="key-note">
            {getKeyStorageMode() === "session"
              ? "キーはタブを閉じると消えます(保存しない設定)。送信先は api.openai.com だけです。"
              : "キーはこのブラウザ内にのみ保存され、送信先は api.openai.com だけです。保存方法は歯車の設定から変更できます。"}
          </div>
          <div className="key-actions">
            <button className="mini-btn" onClick={clear}>削除</button>
            <button className="key-save-btn" onClick={save}>保存</button>
          </div>
        </div>
      )}
    </div>
  );
}
