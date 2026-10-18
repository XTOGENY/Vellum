import { useEffect, useId, useRef, useState } from "react";
import { subscriptionSummary } from "../shared/subscription.mjs";
import { Icon } from "./ui";
import type { Connection } from "./types";
import type { useConnectionAccount } from "./useConnectionAccount";

export default function ConnectionAccount({
  connection,
  account,
}: {
  connection?: Connection;
  account: ReturnType<typeof useConnectionAccount>;
}) {
  const { state, load } = account;
  const summary = subscriptionSummary(state.sub);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const percent = summary.negative
    ? "已耗尽"
    : summary.percent === null
      ? "额度 —"
      : `${summary.percent}%`;
  const balance =
    summary.balance === null ? "—" : summary.balance.toLocaleString("zh-CN");
  const expiry =
    typeof state.sub?.expiresAt === "number" && state.sub.expiresAt > 0
      ? new Date(
          state.sub.expiresAt < 1e12
            ? state.sub.expiresAt * 1000
            : state.sub.expiresAt,
        )
      : null;
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div
      className="account-compact"
      ref={root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!root.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          trigger.current?.focus();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="account-trigger"
        ref={trigger}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`账户额度：剩余 ${balance} 点，NAI5 ${percent}${state.busy ? "，正在更新" : state.error ? "，更新失败" : ""}`}
        onClick={() => setOpen(true)}
      >
        <span className="account-points">
          余 <b>{balance}</b> 点{state.error && <i aria-hidden="true">!</i>}
        </span>
        <span
          className={`account-meter ${summary.negative ? "depleted" : ""}`}
          role="progressbar"
          aria-label="NAI5 剩余生成额度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.percent === null ? undefined : summary.bar}
          aria-valuetext={percent}
        >
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle className="account-ring-track" cx="18" cy="18" r="16" />
            <circle
              className="account-ring-value"
              cx="18"
              cy="18"
              r="16"
              pathLength="100"
              strokeDasharray={`${summary.bar} 100`}
              transform="rotate(-90 18 18)"
            />
          </svg>
        </span>
      </button>
      {open && (
        <div
          className="account-hovercard"
          id={id}
          role="region"
          aria-label="套餐与额度详情"
        >
          <div className="account-detail-paper">
            <header>
              <div>
                <strong>{state.sub ? summary.plan : "账户额度"}</strong>
                <small>{connection?.name || "未选择连接"}</small>
              </div>
              {connection && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="刷新账户额度"
                  disabled={state.busy}
                  onClick={() => void load(true)}
                >
                  <Icon name="refresh" />
                </button>
              )}
            </header>
            <dl>
              <div>
                <dt>剩余点数</dt>
                <dd>
                  {balance} <small>Anlas</small>
                </dd>
              </div>
              <div>
                <dt>订阅 / 购买</dt>
                <dd>
                  {summary.fixed ?? "—"} / {summary.purchased ?? "—"}
                </dd>
              </div>
              <div>
                <dt>NAI5 生成额度</dt>
                <dd>{percent}</dd>
              </div>
              <div>
                <dt>额度恢复</dt>
                <dd>
                  {summary.refillPerHour !== null
                    ? `约 ${summary.refillPerHour.toFixed(2)}% / 小时`
                    : summary.refillPaused
                      ? "已达恢复上限"
                      : "暂未提供"}
                </dd>
              </div>
              {state.sub && (
                <div>
                  <dt>套餐状态</dt>
                  <dd>
                    {summary.active === true
                      ? "生效中"
                      : summary.active === false
                        ? "已到期"
                        : "暂未提供"}
                  </dd>
                </div>
              )}
              {expiry && Number.isFinite(expiry.getTime()) && (
                <div>
                  <dt>有效期至</dt>
                  <dd>{expiry.toLocaleDateString("zh-CN")}</dd>
                </div>
              )}
            </dl>
            {(!state.sub || !connection?.official) && (
              <p>
                {!connection
                  ? "选择连接后自动读取套餐与额度。"
                  : connection.official
                    ? "正在尝试读取账户信息。"
                    : "中转的实际费用以服务商为准；未返回的信息显示为 —。"}
              </p>
            )}
            <footer aria-live="polite">
              {state.busy
                ? "正在更新…"
                : state.error
                  ? state.sub
                    ? "更新失败 · 当前为上次读取的数据"
                    : "暂未获取额度 · 可点击刷新重试"
                  : state.at
                    ? `更新于 ${new Date(state.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · 自动更新`
                    : "等待连接"}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
