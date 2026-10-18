// 历史条目的一行可搜索文本：名称、提示词、负面词、角色、模板、连接等。
// 生成时写一次，旧数据在 Store.init 里补齐，列表接口直接把它带给前端。
export function historySearchText(item, collections = [], connections = []) {
  const params = item?.params || {};
  const connectionName =
    item?.connection ||
    connections.find((c) => c?.id === params.connectionId)?.name;
  const parts = [
    item?.name,
    item?.prompt,
    item?.model,
    item?.seed,
    connectionName,
    params.prompt,
    params.negative,
    params.actualPrompt,
    params.actualNegative,
  ];
  for (const character of params.characters || [])
    parts.push(character?.name, character?.prompt, character?.uc);
  for (const template of params.templates || [])
    parts.push(typeof template === "string" ? template : template?.name);
  for (const id of item?.collections || [])
    parts.push(collections.find((c) => c?.id === id)?.name);
  return parts
    .filter((part) => typeof part === "string" || typeof part === "number")
    .join(" ")
    .toLowerCase();
}
