// ブラウザから直接 OpenAI API を呼ぶクライアント。
// APIキーはこのブラウザの localStorage にだけ保存され、
// 送信先は api.openai.com のみ。他のサーバーには一切送られない。

const KEY_STORAGE = "openai_api_key";
const MODEL = "gpt-image-2";

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || "";
}

export function setApiKey(key) {
  if (key) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

// prompt / images(dataURL配列) / size / quality / n を受け取り、
// dataURL の配列を返す
export async function generateImages({ prompt, images = [], size, quality, n = 1 }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("APIキーが未設定です。右上の「APIキー」から設定してください。");
  }
  if (!prompt || !prompt.trim()) {
    throw new Error("プロンプトが空です。プロンプトノードを接続して内容を入力してください。");
  }

  let response;

  if (images.length > 0) {
    // 参照画像あり → edits エンドポイント(image-to-image / 合成)
    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", prompt);
    form.append("n", String(n));
    if (size !== "auto") form.append("size", size);
    if (quality !== "auto") form.append("quality", quality);
    for (let i = 0; i < images.length; i++) {
      form.append("image[]", await dataUrlToBlob(images[i]), `input_${i}.png`);
    }

    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    // テキストのみ → generations エンドポイント
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, prompt, size, quality, n }),
    });
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || `OpenAI APIエラー (HTTP ${response.status})`;
    throw new Error(message);
  }

  const list = (data?.data || [])
    .map((item) => item?.b64_json)
    .filter(Boolean)
    .map((b64) => `data:image/png;base64,${b64}`);

  if (list.length === 0) {
    throw new Error("APIから画像データが返りませんでした。");
  }

  return list;
}
