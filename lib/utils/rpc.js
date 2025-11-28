function toRpcList(rpc) {
  if (!rpc) return [];
  if (Array.isArray(rpc)) return rpc.filter(Boolean);
  return [rpc];
}

function rpcProviderLabel(prefix, url) {
  try {
    const { hostname } = new URL(url);
    return `${prefix}:${hostname}`;
  } catch (e) {
    return prefix;
  }
}

module.exports = { toRpcList, rpcProviderLabel };
