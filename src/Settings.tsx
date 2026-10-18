import { useEffect, useState } from "react";
import { api } from "./api";
import { applyUiScale, loadPrefs, savePrefs } from "./prefs";
import { Connections } from "./Management";
import { AssistantConnections } from "./AssistantConnections";
import { LibraryFrame, RailButton } from "./LibraryUI";
import { Button, Icon } from "./ui";
import { Select } from "./Select";
import { isChatConnection, isImageConnection } from "./types";
import type { AssistantSettings, Connection } from "./types";
function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
export default function Settings({
  items,
  onChange,
  onError,
  dataDir,
  historyCount,
  templateCount,
}: {
  items: Connection[];
  onChange: (items: Connection[]) => void;
  onError: (message: string) => void;
  dataDir: string;
  historyCount: number;
  templateCount: number;
}) {
  const [section, setSection] = useState("general"),
    [copied, setCopied] = useState(false),
    [storage, setStorage] = useState<{
      activeDir: string;
      nextDir: string;
      defaultDir: string;
      legacyDir: string;
      configFile: string;
      custom: boolean;
      restartRequired: boolean;
    } | null>(null),
    [storagePath, setStoragePath] = useState(""),
    [storageCopy, setStorageCopy] = useState(true),
    [storageBusy, setStorageBusy] = useState(false),
    [storageNote, setStorageNote] = useState(""),
    [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    if (section !== "workspace" || storage) return;
    let alive = true;
    api("/settings/storage")
      .then((next) => {
        if (!alive) return;
        setStorage(next);
        setStoragePath("");
      })
      .catch((e) => {
        if (alive) onError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [section, storage, onError]);
  async function pickStorage() {
    setStorageBusy(true);
    try {
      const next = await api<{ path: string }>(
        "/settings/storage/pick",
        {},
        "POST",
      );
      if (next.path) setStoragePath(next.path);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setStorageBusy(false);
    }
  }
  async function applyStorage() {
    const target = storagePath.trim();
    if (!target) return onError("请填写保存位置");
    setStorageBusy(true);
    setStorageNote("");
    try {
      const next = await api<{
        dataDir: string;
        restartRequired: boolean;
        copied: { files: number; bytes: number; images: number } | null;
        copyWarning: string | null;
      }>(
        "/settings/storage",
        { dataDir: target, mode: storageCopy ? "copy" : "switch" },
        "POST",
      );
      setStorage((current) =>
        current
          ? {
              ...current,
              nextDir: next.dataDir,
              restartRequired: next.restartRequired,
            }
          : current,
      );
      setStoragePath("");
      const copied = next.copied
        ? `，已复制 ${next.copied.files} 个文件（${formatSize(next.copied.bytes)}）`
        : "";
      const warning = next.copyWarning
        ? ` 注意：当前内存状态未能写入磁盘（${next.copyWarning}），这次复制的是最后一次成功保存的数据。`
        : "";
      setStorageNote(
        (next.restartRequired
          ? `已写入 ${next.dataDir}${copied}。关闭并重新打开 Vellum 后生效。`
          : `保存位置已更新为 ${next.dataDir}。`) + warning,
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setStorageBusy(false);
    }
  }
  function updatePrefs(next: Partial<typeof prefs>) {
    const merged = { ...loadPrefs(), ...next };
    if (!savePrefs(merged)) {
      onError("偏好保存失败，请检查浏览器是否允许本地存储后重试。");
      return;
    }
    setPrefs(merged);
    if (next.uiScale !== undefined) applyUiScale(next.uiScale);
  }
  const chatConn = items.find(isChatConnection);
  const assistantPrompt = String(
    (chatConn?.chat as { systemPrompt?: string } | undefined)?.systemPrompt || "",
  );
  function setAssistantPrompt(value: string) {
    if (!chatConn) return;
    onChange(
      items.map((c) =>
        c.id === chatConn.id
          ? { ...c, chat: { ...(c.chat as AssistantSettings), systemPrompt: value } }
          : c,
      ),
    );
  }
  const imageCount = items.filter(isImageConnection).length,
    assistantCount = items.filter(isChatConnection).length;
  return (
    <LibraryFrame
      className="settings-library"
      rail={
        <>
          <div className="rail-title">
            <Icon name="sliders" />
            <h1>设置</h1>
          </div>
          <p className="rail-caption">把工作台安排得顺手。</p>
          <nav aria-label="设置分类">
            <RailButton
              active={section === "general"}
              onClick={() => setSection("general")}
              icon="sliders"
            >
              通用
            </RailButton>
            <RailButton
              active={section === "connections"}
              onClick={() => setSection("connections")}
              icon="link"
              count={imageCount}
            >
              图像连接
            </RailButton>
            <RailButton
              active={section === "assistant"}
              onClick={() => setSection("assistant")}
              icon="chat"
              count={assistantCount}
            >
              助手连接
            </RailButton>
            <RailButton
              active={section === "workspace"}
              onClick={() => setSection("workspace")}
              icon="archive"
            >
              工作空间
            </RailButton>
          </nav>
          <div className="rail-bottom">
            <p>助手只负责讨论与建议，出图连接单独管理。</p>
          </div>
        </>
      }
    >
      <div
        hidden={section !== "connections"}
        className="settings-content connection-settings"
      >
        <Connections
          embedded
          items={items}
          onChange={onChange}
          onError={onError}
        />
      </div>
      <div
        hidden={section !== "assistant"}
        className="settings-content connection-settings"
      >
        <AssistantConnections
          items={items}
          onChange={onChange}
          onError={onError}
        />
      </div>
      <div
        hidden={section !== "general"}
        className="settings-content"
      >
        <div className="settings-stack">
        <header className="library-heading">
          <div>
            <h2>通用</h2>
            <p>界面、NovelAI 和完成提醒。偏好保存在当前浏览器中。</p>
          </div>
        </header>
        <section className="workspace-sheet novelai-settings">
          <header><h3>NovelAI</h3><span className="workspace-status">提示词与图片</span></header>
          <label className="check-row">
            <input type="checkbox" checked={prefs.novelaiTagAutocomplete}
              onChange={(e) => updatePrefs({ novelaiTagAutocomplete: e.target.checked })} />
            <span><b>自动补全 Tag</b><small>输入时显示标签建议，适用于正面词、负面词和角色提示词。</small></span>
          </label>
          <div className="novelai-format-row">
            <div><label htmlFor="novelai-save-format">图片保存格式</label><p>用于之后生成的 NovelAI 作品；保留提示词与参数。</p></div>
            <Select id="novelai-save-format" aria-label="NovelAI 图片保存格式" value={prefs.novelaiSaveFormat}
              onChange={(e) => updatePrefs({ novelaiSaveFormat: e.target.value === "webp" ? "webp" : "png" })}>
              <option value="png">PNG · 通用兼容</option><option value="webp">WebP · 无损压缩</option>
            </Select>
          </div>
        </section>
        <section className="workspace-sheet">
          <header>
            <h3>界面缩放</h3>
            <span className="workspace-status">{prefs.uiScale}%</span>
          </header>
          <div className="scale-choices">
            {[90, 100, 110, 125].map((value) => (
              <button
                key={value}
                aria-pressed={prefs.uiScale === value}
                onClick={() => updatePrefs({ uiScale: value })}
              >
                {value}%
              </button>
            ))}
          </div>
          <p className="note">
            按比例缩放整个界面；布局和字号一起变，适合小屏或高分屏。
          </p>
        </section>
        <section className="workspace-sheet">
          <header>
            <h3>启动方式</h3>
          </header>
          <label className="check-row">
            <input
              type="checkbox"
              checked={prefs.newChatOnLaunch}
              onChange={(e) =>
                updatePrefs({ newChatOnLaunch: e.target.checked })
              }
            />
            <span>
              <b>打开软件时新开一个对话</b>
              <small>旧对话不会被删除，仍可在会话列表里打开。</small>
            </span>
          </label>
        </section>
        <section className="workspace-sheet">
          <header>
            <h3>生成完成提醒</h3>
          </header>
          <label className="check-row">
            <input
              type="checkbox"
              checked={prefs.soundOnDone}
              onChange={(e) => updatePrefs({ soundOnDone: e.target.checked })}
            />
            <span>
              <b>播放提示音</b>
              <small>任务结束两声短音</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={prefs.notifyOnDone}
              onChange={(e) => updatePrefs({ notifyOnDone: e.target.checked })}
            />
            <span>
              <b>发送桌面通知</b>
              <small>切到别的窗口也能看到</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={prefs.followOnDone}
              onChange={(e) => updatePrefs({ followOnDone: e.target.checked })}
            />
            <span>
              <b>完成后自动切到最新作品</b>
              <small>关掉则停留在你正在看的图</small>
            </span>
          </label>
        </section>
        <section className="workspace-sheet">
          <header>
            <h3>小助手默认提示词</h3>
            <span className="workspace-status">
              {chatConn ? chatConn.name : "未连接"}
            </span>
          </header>
          <textarea
            className="assistant-prompt-input"
            rows={3}
            placeholder="例如：回答简短一些，给提示词时直接用英文标签。"
            disabled={!chatConn}
            value={assistantPrompt}
            onChange={(e) => setAssistantPrompt(e.target.value)}
          />
          <p className="note">
            会接在助手原有规则后面一起发送；留空则只用默认规则。
          </p>
        </section>
        </div>
      </div>
      {section === "workspace" && (
        <div className="settings-content">
          <header className="library-heading">
            <div>
              <h2>工作空间</h2>
              <p>管理本机资料与保存位置。</p>
            </div>
          </header>
          <section className="workspace-sheet">
            <header>
              <h3>本地资料</h3>
              <span className="workspace-status">
                <i />
                已连接本机服务
              </span>
            </header>
            <dl className="workspace-counts">
              <div>
                <dt>生成记录</dt>
                <dd>{historyCount} 张</dd>
              </div>
              <div>
                <dt>提示词模板</dt>
                <dd>{templateCount} 个</dd>
              </div>
              <div>
                <dt>图像连接</dt>
                <dd>{imageCount} 套</dd>
              </div>
              <div>
                <dt>助手连接</dt>
                <dd>{assistantCount} 套</dd>
              </div>
            </dl>
            <div className="workspace-path">
              <div>
                <h4>数据保存位置</h4>
                <p>
                  图片、历史记录、模板和草稿都在这个文件夹里；建议放到空间充足的非系统盘。
                </p>
              </div>
              <div className="storage-current">
                <span>当前</span>
                <code>{storage?.activeDir || dataDir || "正在读取…"}</code>
                <Button
                  small
                  disabled={!(storage?.activeDir || dataDir)}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        storage?.activeDir || dataDir,
                      );
                      setCopied(true);
                    } catch {
                      onError("无法复制路径，请手动选中复制。");
                    }
                  }}
                >
                  {copied ? "已复制" : "复制"}
                </Button>
              </div>
              <div className="storage-field">
                <label htmlFor="storage-path">新位置</label>
                <div className="storage-picker">
                  <input
                    id="storage-path"
                    className="storage-input"
                    value={storagePath}
                    spellCheck={false}
                    placeholder="选择或输入新的文件夹，例如 D:\Vellum-Data"
                    onChange={(e) => setStoragePath(e.target.value)}
                  />
                  <Button small onClick={pickStorage} disabled={storageBusy}>
                    浏览…
                  </Button>
                </div>
              </div>
              <div className="storage-actions">
                <label className="storage-copy">
                  <input
                    type="checkbox"
                    checked={storageCopy}
                    onChange={(e) => setStorageCopy(e.target.checked)}
                  />
                  <span>把现有数据复制到新位置（原目录保留）</span>
                </label>
                <Button
                  primary
                  onClick={applyStorage}
                  disabled={storageBusy || !storagePath.trim()}
                >
                  {storageBusy ? "处理中…" : "应用位置"}
                </Button>
              </div>
              {storageNote ? (
                <p className="note storage-note">{storageNote}</p>
              ) : storage?.restartRequired ? (
                <p className="note storage-note">
                  已安排切换到 {storage.nextDir}，关闭并重新打开 Vellum 后生效。
                </p>
              ) : (
                <p className="note">
                  应用后关闭并重新打开 Vellum 生效；不勾选复制时，新位置是空的。
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </LibraryFrame>
  );
}
