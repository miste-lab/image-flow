import React, { useEffect, useRef, useState } from "react";
import { getKeyStorageMode, setKeyStorageMode } from "../api.js";

// 歯車ボタン + 設定ポップオーバー。今後の設定項目はここに足していく
export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [keyMode, setKeyMode] = useState(getKeyStorageMode());
  const rootRef = useRef(null);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const changeKeyMode = (mode) => {
    setKeyStorageMode(mode);
    setKeyMode(mode);
  };

  return (
    <div className="key-panel-root" ref={rootRef}>
      <button
        className="tool-btn gear-btn"
        onClick={() => setOpen((o) => !o)}
        title="設定"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className="key-popover settings-popover">
          <div className="key-title">設定</div>

          <div className="settings-section">
            <div className="settings-label">APIキーの保存方法</div>
            <label className="settings-radio">
              <input
                type="radio"
                name="key-mode"
                checked={keyMode === "local"}
                onChange={() => changeKeyMode("local")}
              />
              <span>
                このブラウザに保存
                <small>次回から入力不要。共有PCでは非推奨</small>
              </span>
            </label>
            <label className="settings-radio">
              <input
                type="radio"
                name="key-mode"
                checked={keyMode === "session"}
                onChange={() => changeKeyMode("session")}
              />
              <span>
                保存しない (毎回入力)
                <small>タブを閉じるとキーが消える。より安全</small>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
