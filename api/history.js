// Simple in-memory history API for CryptoFeeScope (Phase 3)
//
// 注意: Vercel のサーバレス関数の「メモリ」はプロセスごとに保持されるだけなので
// デプロイをまたぐと消えます。
// ここでは「仕組みのテスト用」として、直近の履歴を見せられればOKという前提です。

const MAX_POINTS = 1440; // 24h 分 (60sec * 24h)

let HISTORY = [];

/**
 * /api/history
 *
 * GET: 最新の履歴配列を返す（内部で /api/snapshot を叩いて 1 点追加してから返却）
 */
export default async function handler(req, res) {
  try {
    const host = req.headers.host || process.env.VERCEL_URL || 'localhost:3000';
    const isLocal = host.startsWith('localhost');
    const baseUrl = (isLocal ? 'http://' : 'https://') + host;

    const snapshotRes = await fetch(baseUrl + '/api/snapshot');
    if (!snapshotRes.ok) {
      throw new Error('Failed to fetch snapshot: HTTP ' + snapshotRes.status);
    }
    const snapshot = await snapshotRes.json();

    const now = Date.now();

    const row = {
      ts: now,
      ...snapshot,
    };

    HISTORY.push(row);
    if (HISTORY.length > MAX_POINTS) {
      HISTORY = HISTORY.slice(-MAX_POINTS);
    }

    res.status(200).json(HISTORY);
  } catch (err) {
    console.error('history error', err);
    res
      .status(500)
      .json({
        error: 'history_failed',
        message: String((err && err.message) || err),
      });
  }
}
