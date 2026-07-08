// ノードの初期データ・ID採番・ワークスペースの初期構成

// ノード種別ごとの初期データ (毎回新しいオブジェクトを返す)
export const makeDefaults = (type) =>
  ({
    prompt: { text: "" },
    imageInput: { image: null, fileName: null },
    memo: { text: "" },
    // uid はノード固有のID。履歴とジョブグリッドが「どの生成ノードの結果か」を
    // 判別するのに使う (表示用IDの generate-1 などは番号が再利用されるため不可)
    generate: { uid: crypto.randomUUID(), prompt: "", model: "gpt-image-2", size: "auto", quality: "auto", resolution: "auto", count: 1, results: [], loading: false, error: null },
    videoGen: { uid: crypto.randomUUID(), prompt: "", model: "standard", resolution: "720p", duration: "auto", aspect: "auto", audio: true, count: 1, videoUrls: [], loading: false, status: null, error: null },
    upscale: { model: "topaz", resolution: "1080p", fps: "30", videoUrl: null, loading: false, status: null, error: null },
    jobGrid: {},
  })[type];

// リサイズ可能なノードの初期サイズ (node.width / node.height に入れる)
export const INIT_SIZE = {
  prompt: { width: 280, height: 190 },
  imageInput: { width: 230, height: 230 },
  memo: { width: 260, height: 190 },
  jobGrid: { width: 340, height: 400 },
};

// 空いている最小番号でIDを作る (ノードを消すとその番号が再利用される)
export const makeId = (type, nds) => {
  const used = new Set();
  for (const n of nds) {
    if (n.type !== type) continue;
    const m = n.id.match(/(\d+)$/);
    if (m) used.add(Number(m[1]));
  }
  let i = 1;
  while (used.has(i)) i++;
  return `${type}-${i}`;
};

// 新規ワークスペース: プロンプト → 生成 のサンプル構成で始まる
export const newWorkspace = (name) => ({
  id: crypto.randomUUID(),
  name,
  updatedAt: Date.now(),
  nodes: [
    { id: "prompt-1", type: "prompt", position: { x: 80, y: 160 }, ...INIT_SIZE.prompt, data: makeDefaults("prompt") },
    { id: "generate-1", type: "generate", position: { x: 460, y: 100 }, data: makeDefaults("generate") },
  ],
  edges: [{ id: "e1", source: "prompt-1", target: "generate-1", targetHandle: "prompt", type: "deletable" }],
});
