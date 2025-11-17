// scripts/push-history-from-snapshot.mjs
// 1回分の snapshot を取得して、Supabase の history テーブルに保存するスクリプト。
// GitHub Actions から実行して「自動で履歴を貯める」役割だけを担う。

const SNAPSHOT_URL =
  process.env.SNAPSHOT_URL || "https://cryptofeescope.vercel.app/api/snapshot";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Supabase env missing");
  process.exit(1);
}

async function main() {
  // 1. 現在のスナップショットを取得
  const snapRes = await fetch(SNAPSHOT_URL);
  if (!snapRes.ok) {
    console.error("snapshot fetch failed", snapRes.status);
    const text = await snapRes.text();
    console.error(text);
    process.exit(1);
  }
  const snapshot = await snapRes.json();
  // 期待する形：
  // {
  //   bitcoin:  { feeUSD, speedSec, status, updated, ... },
  //   ethereum: { ... },
  //   ...
  // }

  const chains = Object.entries(snapshot);
  if (chains.length === 0) {
    console.error("snapshot empty");
    process.exit(0);
  }

  // ts は bitcoin の updated か、なければ現在時刻
  const anyUpdated = chains[0][1]?.updated;
  const tsMillis = typeof anyUpdated === "number" ? anyUpdated : Date.now();
  const tsIso = new Date(tsMillis).toISOString();

  // Supabase history テーブル用の行に変換
  const rows = chains.map(([chain, v]) => ({
    ts: tsIso,
    chain,
    fee_usd: v && v.feeUSD != null ? Number(v.feeUSD) : null,
    speed_sec: v && v.speedSec != null ? Number(v.speedSec) : null,
    status: v && v.status ? String(v.status) : null,
  }));

  // 2. Supabase に INSERT
  const url = new URL(`${SUPABASE_URL}/rest/v1/history`);
  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!resp.ok) {
    console.error("Supabase insert failed", resp.status);
    const text = await resp.text();
    console.error(text);
    process.exit(1);
  }

  console.log(`inserted ${rows.length} rows at ${tsIso}`);
}

main().catch((err) => {
  console.error("push-history script failed", err);
  process.exit(1);
});
