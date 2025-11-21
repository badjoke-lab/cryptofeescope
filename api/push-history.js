// api/push-history.js
// 最新スナップショットを取得して Supabase の history テーブルに 1 行 INSERT する

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("Supabase env missing");
    res.status(500).json({ error: "supabase_env_missing" });
    return;
  }

  try {
    // 1. まず現在のスナップショットを API 経由で取得
    const snapshotResp = await fetch(
      `${process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : ""}/api/snapshot`
    );

    if (!snapshotResp.ok) {
      const text = await snapshotResp.text();
      console.error("snapshot fetch failed", snapshotResp.status, text);
      res.status(500).json({
        error: "snapshot_failed",
        status: snapshotResp.status,
        body: text,
      });
      return;
    }

    const snapshot = await snapshotResp.json();
    const chains = snapshot && snapshot.chains ? snapshot.chains : {};

    const nowIso = new Date().toISOString();

    // 2. 各チェーンごとに 1 行ずつ history に INSERT
    const rows = [];
    for (const [chain, data] of Object.entries(chains)) {
      rows.push({
        ts: nowIso,
        chain,
        fee_usd: data.feeUSD ?? null,
        speed_sec: data.speedSec ?? null,
        status: data.status ?? null,
        // raw 列を作っていないならコメントアウトのままでOK
        // raw: data,
      });
    }

    const url = new URL(`${supabaseUrl}/rest/v1/history`);
    url.searchParams.set("select", "ts");

    const insertResp = await fetch(url.toString(), {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });

    if (!insertResp.ok) {
      const text = await insertResp.text();
      console.error("Supabase insert failed", insertResp.status, text);
      res.status(500).json({
        error: "supabase_insert_failed",
        status: insertResp.status,
        body: text,
      });
      return;
    }

    res.status(200).json({ ok: true, inserted: rows.length });
  } catch (err) {
    console.error("push-history error", err);
    res.status(500).json({
      error: "push_history_failed",
      message: String(err && err.message ? err.message : err),
    });
  }
}
