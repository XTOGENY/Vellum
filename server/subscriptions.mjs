// Read-only account queries must not acquire the image-generation lock.
export function subscriptionReader(store, provider, ttl = 15000) {
  const entries = new Map();
  return {
    invalidate(id) {
      entries.delete(id);
    },
    async read(id, force = false) {
      if (!store.state.connections.some((c) => c.id === id))
        throw Error("连接不存在");
      let entry = entries.get(id);
      if (entry?.pending) return entry.pending;
      if (!force && entry?.value && Date.now() - entry.at < ttl)
        return entry.value;
      entry = { value: entry?.value, at: entry?.at || 0, pending: null };
      entries.set(id, entry);
      entry.pending = (async () => {
        try {
          const value = await provider.subscription(await store.connection(id));
          if (!value || !Number.isFinite(value.tier))
            throw Error("此连接未提供可识别的套餐信息");
          entry.value = value;
          entry.at = Date.now();
          return value;
        } finally {
          entry.pending = null;
        }
      })();
      return entry.pending;
    },
  };
}
