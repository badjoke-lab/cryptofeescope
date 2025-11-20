// /api/history.js — 安全ダミー版
//
// 目的：絶対に 500 を返さないようにする。
// まだ本番用の履歴実装は行わず、空配列だけを返す。
// グラフは「データなし」で描画されるが、サイト全体は落ちなくなる。

export default function handler(req, res) {
  // CORS（念のため）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const now = new Date().toISOString();

  // チェーンごとの空履歴
  const historyByChain = {
    btc: [],
    eth: [],
    arb: [],
    op: [],
    sol: [],
  };

  res.status(200).json({
    ok: true,
    generatedAt: now,
    history: historyByChain,
  });
}
