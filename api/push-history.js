// /api/push-history.js
//
// Fetch /api/snapshot → 5チェーン分を Supabase に保存する API
// Vercel cron から毎分叩く（あなたは cron を有効化するだけ）

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY // ← ここは "SERVICE ROLE" を使う
    );

    const host = req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const baseUrl = `${proto}://${host}`;

    const snapRes = await fetch(`${baseUrl}/api/snapshot`);
    if (!snapRes.ok) {
      throw new Error(`snapshot fetch failed: ${snapRes.status}`);
    }
    const snap = await snapRes.json();

    // サマリ形式に Flatten
    const rows = Object.keys(snap)
      .filter((key) => key !== "updated")
      .map((chain) => {
        const s = snap[chain];
        return {
          ts: new Date(snap.updated),
          chain,
          fee_usd: s.feeUSD ?? null,
          speed_sec: s.speedSec ?? null,
          status: s.status ?? null,
          raw_json: s,
        };
      });

    const { error } = await supabase.from("history").insert(rows);
    if (error) {
      throw error;
    }

    return res.status(200).json({
      ok: true,
      inserted: rows.length,
      ts: snap.updated,
    });
  } catch (err) {
    console.error("push-history failed", err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err)
    });
  }
}
