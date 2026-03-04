import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

let fatalShown = false;

function stringifyError(input: unknown): string {
  if (input instanceof Error) {
    return `${input.name}: ${input.message}\n${input.stack ?? ""}`.trim();
  }
  return String(input);
}

function showFatal(error: unknown): void {
  if (fatalShown) {
    return;
  }
  fatalShown = true;
  const root = document.getElementById("root") ?? document.body;
  const message = stringifyError(error);
  root.innerHTML = `
    <div style="padding:16px;font-family:sans-serif;line-height:1.5;">
      <h2 style="margin:0 0 8px;">页面启动失败</h2>
      <p style="margin:0 0 8px;">前端在渲染前崩溃，请复制下面报错内容提交反馈。</p>
      <pre style="white-space:pre-wrap;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;padding:10px;overflow:auto;">${message}</pre>
    </div>
  `;
}

window.addEventListener("error", (event) => {
  showFatal(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  showFatal(event.reason);
});

try {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("未找到 #root 挂载节点");
  }
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  showFatal(error);
}
