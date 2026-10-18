# Vellum

本机运行的图像创作工作台，支持提示词编辑、画师组合、图像参考、生成与作品整理。

## 启动

需要 Windows x64 与 Node.js 24 或更新版本。

```sh
git clone https://github.com/XTOGENY/Vellum.git
cd Vellum
npm ci
npm run build
npm start
```

打开 http://127.0.0.1:8780/，在设置中配置自己的模型连接。也可以运行 `start.cmd`。

## 数据

连接、模板、画师资料、草稿和作品均在使用时保存在本机，仓库不附带个人资料。首次启动为空白工作空间。密钥使用当前 Windows 用户的 DPAPI 加密保存。

不要上传 `data/`、`.local/`、`config.json` 或导出、备份文件。在线生成和对话会访问自行配置的服务，并可能产生费用。

## 分词器说明

此版本按仓库所有者要求，对历史中指定的三个字符串作了严格替换，包含公共词表中的同名片段。词表可加载，但受影响词语的 Token 计数可能与原始官方词表不同；界面计数仅供参考。
