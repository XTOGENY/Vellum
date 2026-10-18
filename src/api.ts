export async function api<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-NWENAI-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => {
    throw new Error("暂时无法连接本机服务，请稍后重试。");
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `请求失败 ${r.status}`);
  return j;
}
export function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 32 * 1024 * 1024)
      return reject(new Error("图片不能超过 32 MB"));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("无法读取文件"));
    r.readAsDataURL(file);
  });
}
export function download(
  name: string,
  body: string | Blob,
  type = "application/json",
) {
  const blob = typeof body === "string" ? new Blob([body], { type }) : body,
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function imageToData(url: string) {
  const r = await fetch(url);
  return fileData(
    new File([await r.blob()], "image.png", { type: "image/png" }),
  );
}
