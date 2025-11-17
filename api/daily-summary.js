export default async function handler(req, res) {
  try {
    const host = req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const baseUrl = `${proto}://${host}`;

    const historyRes = await fetch(`${baseUrl}/api/history`);
    const history = await historyRes.json();

    if (!Array.isArray(history) || history.length === 0) {
      res.status(200).json({
        generatedAt: new Date().toISOString(),
        chains: {},
        message: "No history yet"
      });
      return;
    }

    const latest = history[history.length - 1];
    const chainIds = Object.keys(latest).filter(k => k !== "ts");

    const summary = {};
    chainIds.forEach(id => {
      summary[id] = {
        latestFeeUSD: null,
        minFeeUSD: null,
        maxFeeUSD: null,
        avgFeeUSD: null,
        samples: 0
      };
    });

    for (const point of history) {
      for (const id of chainIds) {
        const snap = point[id];
        if (!snap || snap.feeUSD == null) continue;
        const value = Number(snap.feeUSD);
        if (!Number.isFinite(value)) continue;

        const s = summary[id];

        if (s.samples === 0) {
          s.minFeeUSD = value;
          s.maxFeeUSD = value;
          s.avgFeeUSD = value;
        } else {
          s.minFeeUSD = Math.min(s.minFeeUSD, value);
          s.maxFeeUSD = Math.max(s.maxFeeUSD, value);
          s.avgFeeUSD = (s.avgFeeUSD * s.samples + value) / (s.samples + 1);
        }

        s.latestFeeUSD = value;
        s.samples += 1;
      }
    }

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      points: history.length,
      chains: summary
    });

  } catch (err) {
    res.status(500).json({
      error: "daily_summary_failed",
      message: err.message || String(err)
    });
  }
}
