// Vercel serverless function: receives batched feed events and writes them to MongoDB Atlas.
// Deploy: put this repo on Vercel; set env vars MONGODB_URI and ALLOWED_ORIGIN
// (ALLOWED_ORIGIN = https://<your-github-username>.github.io)

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

// Reuse one connection across warm invocations
let clientPromise;
function getClient() {
  if (!clientPromise) clientPromise = new MongoClient(uri, { maxPoolSize: 5 }).connect();
  return clientPromise;
}

const EVENT_TYPES = new Set([
  "feed_start", "feed_complete",
  "post_view",          // post entered viewport (IntersectionObserver)
  "dwell",              // post left viewport; duration_ms = time visible
  "badge_tap",          // tapped the Content Credentials "cr" badge
  "modal_open", "modal_close", // modal_close carries duration_ms
  "learn_more",
  "like", "save", "share"      // value: true (on) / false (off)
]);

const str = (v, max) => (typeof v === "string" && v.length <= max ? v : null);
const num = (v) => (Number.isFinite(v) ? v : null);

function clean(e) {
  const tier = Number(e.tier);
  if (![1, 2, 3, 4].includes(tier)) return null;
  if (!EVENT_TYPES.has(e.event_type)) return null;
  const session_id = str(e.session_id, 64);
  if (!session_id) return null;
  return {
    session_id,
    tier,
    country: str(e.country, 8),
    event_type: e.event_type,
    post_id: str(e.post_id, 32),
    domain: str(e.domain, 16),       // "political" | "science"
    position: num(e.position),       // 1-12, order shown to this participant
    value: typeof e.value === "boolean" ? e.value : null,
    duration_ms: num(e.duration_ms),
    seq: num(e.seq),                 // per-session counter, detects lost/out-of-order events
    ts_client: num(e.ts_client),
    t_rel_ms: num(e.t_rel_ms),       // ms since page load (monotonic)
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  // Sent as text/plain (keeps sendBeacon CORS-safe), so parse manually
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).end(); }
  }
  const raw = Array.isArray(body?.events) ? body.events.slice(0, 200) : [];
  const ts_server = new Date();
  const docs = raw.map(clean).filter(Boolean).map((d) => ({ ...d, ts_server }));
  if (!docs.length) return res.status(204).end();

  try {
    const db = (await getClient()).db("c2pa_feed");
    await db.collection("events").insertMany(docs, { ordered: false });
    return res.status(204).end();
  } catch (err) {
    console.error(err);
    return res.status(500).end();
  }
}
