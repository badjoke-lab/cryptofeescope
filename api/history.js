// /api/history.js — 完全版

import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  try {
    const file = path.join(process.cwd(), "data-history.json");

    let old = [];
    if (fs.existsSync(file)) {
      old = JSON.parse(fs.readFileSync(file, "utf8"));
    }

    // 最新 snapshot を呼び出す
    const snap = await fetch("https://cryptofeescope.vercel.app/api/snapshot")
      .then(r => r.json());

    const entry = {
      ts: Date.now(),
      ...snap
    };

    const updated = [...old, entry].slice(-200); // 最大200件保持
    fs.writeFileSync(file, JSON.stringify(updated, null, 2));

    res.status(200).json(updated);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "history failed" });
  }
}
