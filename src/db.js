// ワークスペース(ノード+エッジ)と生成履歴を IndexedDB に保存する薄いラッパー。
// localStorage ではなく IndexedDB を使うのは、画像(dataURL)入りの
// キャンバスが localStorage の容量制限(約5MB)をすぐ超えるため。
//
// 生成履歴は2つのストアに分けている:
//  - history       : メタ情報 + 縮小サムネイル (一覧表示はこちらだけ読むので軽い)
//  - historyImages : id → フル解像度の画像 (保存・拡大表示のときだけ取り出す)

const DB_NAME = "image-flow";
const STORE = "workspaces";
const HISTORY = "history";
const HISTORY_IMG = "historyImages";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(HISTORY)) {
        db.createObjectStore(HISTORY, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(HISTORY_IMG)) {
        db.createObjectStore(HISTORY_IMG, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const listWorkspaces = () => withStore(STORE, "readonly", (s) => s.getAll());
export const getWorkspace = (id) => withStore(STORE, "readonly", (s) => s.get(id));
export const putWorkspace = (ws) => withStore(STORE, "readwrite", (s) => s.put(ws));
export const deleteWorkspace = (id) => withStore(STORE, "readwrite", (s) => s.delete(id));

/* ---------- 生成履歴 ---------- */

// フル画像から一覧用の縮小サムネイル(JPEG)を作る
function makeThumb(dataUrl, max = 384) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(dataUrl); // 縮小に失敗したらフル画像で代用
    img.src = dataUrl;
  });
}

// 1回の生成(1ジョブ)を履歴に追加する。画像1枚 = 1レコード。
// uid は生成ノード固有のID (ジョブグリッドが「どのノードの履歴か」を判別するのに使う)
export async function addHistory({ uid, prompt, images }) {
  const jobId = crypto.randomUUID();
  const ts = Date.now();
  for (const image of images) {
    const id = crypto.randomUUID();
    const thumb = await makeThumb(image);
    await withStore(HISTORY, "readwrite", (s) =>
      s.put({ id, jobId, uid, prompt, ts, thumb })
    );
    await withStore(HISTORY_IMG, "readwrite", (s) => s.put({ id, image }));
  }
  // 開いているジョブグリッドや履歴一覧に「増えたよ」と知らせる
  window.dispatchEvent(new Event("history-changed"));
}

// 動画の先頭フレームから一覧用サムネイルを作る
function makeVideoThumb(blobUrl, max = 384) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.onloadeddata = () => {
      try { v.currentTime = 0.05; } catch { resolve(null); }
    };
    v.onseeked = () => {
      try {
        const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(v.videoWidth * scale));
        c.height = Math.max(1, Math.round(v.videoHeight * scale));
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.82));
      } catch {
        resolve(null);
      }
    };
    v.onerror = () => resolve(null);
    v.src = blobUrl;
  });
}

// サムネイルが作れなかったとき用の代替 (▶マーク入りの黒い板)
const FALLBACK_VIDEO_THUMB =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="384" height="216"><rect width="100%" height="100%" fill="#131316"/><path d="M172 78v60l52-30z" fill="#85878f"/></svg>'
  );

// 動画1本を履歴に追加する。動画本体は dataURL で historyImages に保存
// (falのURLは期限切れの可能性があるため、取り込んでおく)
export async function addVideoHistory({ uid, prompt, videoUrl }) {
  const blob = await (await fetch(videoUrl)).blob();
  const blobUrl = URL.createObjectURL(blob);
  const thumb = (await makeVideoThumb(blobUrl)) || FALLBACK_VIDEO_THUMB;
  URL.revokeObjectURL(blobUrl);
  const video = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  const id = crypto.randomUUID();
  await withStore(HISTORY, "readwrite", (s) =>
    s.put({ id, jobId: crypto.randomUUID(), uid, prompt, ts: Date.now(), thumb, kind: "video" })
  );
  await withStore(HISTORY_IMG, "readwrite", (s) => s.put({ id, image: video }));
  window.dispatchEvent(new Event("history-changed"));
}

export const listHistory = () => withStore(HISTORY, "readonly", (s) => s.getAll());

export const getHistoryImage = async (id) => {
  const rec = await withStore(HISTORY_IMG, "readonly", (s) => s.get(id));
  return rec?.image || null;
};

export async function deleteHistory(id) {
  await withStore(HISTORY, "readwrite", (s) => s.delete(id));
  await withStore(HISTORY_IMG, "readwrite", (s) => s.delete(id));
  window.dispatchEvent(new Event("history-changed"));
}

// ブラウザ全体のストレージ使用量の概算 (対応ブラウザのみ)
export async function estimateStorage() {
  try {
    return (await navigator.storage?.estimate?.()) || null;
  } catch {
    return null;
  }
}
