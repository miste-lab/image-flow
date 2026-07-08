import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages はサブパス(/リポジトリ名/)で配信されるため相対パスにする
  base: "./",
  server: {
    port: 3000,
  },
});
