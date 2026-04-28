import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Build id = short hash of package.json + current timestamp. Baked into the
// client as __BUILD_ID__ and also written to /dist/version.json so a deployed
// tab can detect "new version available" and prompt the user to reload.
const BUILD_ID =
  crypto.createHash("sha256")
    .update(fs.readFileSync(path.resolve("package.json"), "utf8"))
    .update(String(Date.now()))
    .digest("hex")
    .slice(0, 10);

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: "write-version-json",
      apply: "build",
      closeBundle() {
        const out = path.resolve("dist", "version.json");
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(
          out,
          JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() }, null, 2),
        );
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(command === "build" ? BUILD_ID : "dev"),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3021",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
}));
