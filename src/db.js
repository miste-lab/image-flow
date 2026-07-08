// ワークスペース(ノード+エッジ)を IndexedDB に保存する薄いラッパー。
// localStorage ではなく IndexedDB を使うのは、画像(dataURL)入りの
// キャンバスが localStorage の容量制限(約5MB)をすぐ超えるため。

const DB_NAME = "image-flow";
const STORE = "workspaces";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const listWorkspaces = () => withStore("readonly", (s) => s.getAll());
export const getWorkspace = (id) => withStore("readonly", (s) => s.get(id));
export const putWorkspace = (ws) => withStore("readwrite", (s) => s.put(ws));
export const deleteWorkspace = (id) => withStore("readwrite", (s) => s.delete(id));
