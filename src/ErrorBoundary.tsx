import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  label: string;
  hint?: string;
  children: ReactNode;
};
type State = { error: Error | null };

// 一块界面炸了不该带走整个应用：捕获渲染异常，只降级这一块。
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 留一份在控制台，方便你截图发我。
    console.error("[Vellum]", this.props.label, error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="boundary-fallback" role="alert">
        <b>{this.props.label}出错了</b>
        <p className="note">{error.message || String(error)}</p>
        {this.props.hint && <p className="note">{this.props.hint}</p>}
        <div className="actions">
          <button
            type="button"
            className="btn small"
            onClick={() => this.setState({ error: null })}
          >
            重试这一块
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => location.reload()}
          >
            重新载入
          </button>
        </div>
      </div>
    );
  }
}
