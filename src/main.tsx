import React from "react";
import { applyUiScale, loadPrefs } from "./prefs";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import "./styles.css";
import "./feature-completion.css";
import "./library.css";
import "./image-import.css";
applyUiScale(loadPrefs().uiScale);

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary
    label="工作台"
    hint="这是整个应用渲染时出的错。点重试或重新载入；如果反复出现，去「设置 → 图像连接」删掉最近添加的那条连接。"
  >
    <App />
  </ErrorBoundary>,
);
