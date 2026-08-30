import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    modulePreload: false,
    outDir: "node_modules/.cache/runtime-tests",
    rollupOptions: {
      input: {
        "approval_policy.test": resolve(__dirname, "test/approval_policy.test.ts"),
        "dom_tool_activity.test": resolve(__dirname, "test/dom_tool_activity.test.ts"),
        "network_capture_runtime.test": resolve(__dirname, "test/network_capture_runtime.test.ts"),
        "result_delivery.test": resolve(__dirname, "test/result_delivery.test.ts"),
        "tool_call_tracker.test": resolve(__dirname, "test/tool_call_tracker.test.ts"),
        "tool_activity.test": resolve(__dirname, "test/tool_activity.test.ts"),
        "tool_activity_overlay.test": resolve(__dirname, "test/tool_activity_overlay.test.ts"),
        "tool_result.test": resolve(__dirname, "test/tool_result.test.ts"),
      },
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: "[name].js",
      },
    },
    target: "es2022",
  },
  publicDir: false,
  resolve: {
    alias: {
      "@webcode/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
