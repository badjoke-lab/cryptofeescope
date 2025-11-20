// api/history.js
// Supabase の history テーブルから履歴を読み出し、
// 既存の /api/history と同じような
// 「[ { ts, bitcoin: {...}, ethereum: {...}, ... } ]」形式に整形して返す。

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("Supabase env missing");
    res.status(500).json({ error: "supabase_env_missing" });
    return;
  }

  // 直近 N 件だけに絞る（例: 最新 2880 行 ≒ 5 分間隔で 1 日分）
  const limit = Number(req.query.limit || "2880");
  const chainFilter = req.query.chain || ""; // 例: "bitcoin"

  try {
    const url = new URL(`${supabaseUrl}/rest/v1/history`);

    // 取り出すカラム（raw は使わない）
    url.searchParams.set("select", "ts,chain,fee_usd,speed_sec,status");

    // チェーン指定があればフィルタ
    if (chainFilter) {
      // Supabase の REST フィルタ構文: chain=eq.bitcoin
      url.searchParams.set("chain", `eq.${chainFilter}`);
    }

    // 時刻昇順で取得
    url.searchParams.set("order", "ts.asc");
    url.searchParams.set("limit", String(limit));

    const resp = await fetch(url.toString(), {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Supabase select failed", resp.status, text);
      res.status(500).json({
        error: "supabase_select_failed",
        status: resp.status,
        body: text,
      });
      return;
    }

    const rows = await resp.json(); // [{ ts, chain, fee_usd, ... }, ...]

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(200).json([]);
      return;
    }

    // ts ごとにまとめて、既存形式に変換
    /** @type {Record<string, any>} */
    const byTs = {};

    for (const row of rows) {
      const ts = row.ts;
      if (!byTs[ts]) {
        // ts はミリ秒の number にそろえる
        byTs[ts] = { ts: new Date(ts).getTime() };
      }

      const chain = row.chain;
      if (!chain) continue;

      byTs[ts][chain] = {
        feeUSD: row.fee_usd != null ? Number(row.fee_usd) : null,
        speedSec: row.speed_sec != null ? Number(row.speed_sec) : null,
        status: row.status || null,
      };
    }

    const points = Object.values(byTs).sort(
      (a, b) => /** @type any */ (a).ts - /** @type any */ (b).ts
    );

    res.status(200).json(points);
  } catch (err) {
    console.error("history error", err);
    res.status(500).json({
      error: "history_failed",
      message: String(err && err.message ? err.message : err),
    });
  }
}
