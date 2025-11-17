// api/history.js
// Supabase の history テーブルから直近の履歴を読み出し、
// これまでの /api/history と同じ「配列 + チェーンごとのオブジェクト」に整形して返す。

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("Supabase env missing");
    res.status(500).json({ error: "supabase_env_missing" });
    return;
  }

  // limit クエリのバリデーション（デフォ 2880, 最大 5000）
  const rawLimit = typeof req.query.limit === "string" ? req.query.limit : "2880";
  let limit = parseInt(rawLimit, 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = 2880;
  }
  if (limit > 5000) {
    limit = 5000;
  }

  // チェーン絞り込み（例: ?chain=bitcoin）
  const chainFilter =
    typeof req.query.chain === "string" && req.query.chain.trim() !== ""
      ? req.query.chain.trim()
      : null;

  try {
    const url = new URL(`${supabaseUrl}/rest/v1/history`);

    // 取得カラム
    url.searchParams.set("select", "ts,chain,fee_usd,speed_sec,status,raw");

    // チェーンで絞り込み（指定があれば）
    if (chainFilter) {
      // PostgREST の eq フィルタ
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

    /** @type {Array<any>} */
    const rows = await resp.json(); // [{ ts, chain, fee_usd, ... }, ...]

    if (!Array.isArray(rows) || rows.length === 0) {
      // 履歴がまだ無い場合は空配列を返す
      res.status(200).json([]);
      return;
    }

    // ts ごとにまとめて、既存形式に変換
    /** @type {Record<string, any>} */
    const byTs = {};

    for (const row of rows) {
      const tsStr = row.ts;
      if (!tsStr) continue;

      const tsMillis = Number(new Date(tsStr).getTime());
      if (!Number.isFinite(tsMillis)) continue;

      if (!byTs[tsStr]) {
        byTs[tsStr] = { ts: tsMillis };
      }

      const chain = row.chain;
      if (!chain) continue;

      const pointForTs = byTs[tsStr];

      pointForTs[chain] = {
        feeUSD: row.fee_usd != null ? Number(row.fee_usd) : null,
        speedSec: row.speed_sec != null ? Number(row.speed_sec) : null,
        status: row.status || null,
        // raw が JSONB で入っている場合はそのまま展開
        ...(row.raw && typeof row.raw === "object" ? row.raw : {}),
      };
    }

    // ts 昇順にソートして配列に
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
