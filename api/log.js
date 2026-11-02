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

// Event names used by the c2pa-provenance feed builds (index00-03), e.g.
// ready, feed_complete, post_enter_view, post_exit_view (duration_ms = dwell),
// badge_click, banner_click, image_click (value = opened), view_more_click (value = expanded),
// cta_click, learn_more_click, try_it_now_click, view_full_details_click.
// Any lowercase snake_case name is accepted so new buttons log without a server change.
const EVENT_NAME = /^[a-z][a-z0-9_]{1,39}$/;

const str = (v, max) => (typeof v === "string" && v.length <= max ? v : null);
const num = (v) => (Number.isFinite(v) ? v : null);

function clean(e) {
  const tier = Number(e.tier);
  if (![0, 1, 2, 3, 4].includes(tier)) return null;
  if (typeof e.event_type !== "string" || !EVENT_NAME.test(e.event_type)) return null;
  const session_id = str(e.session_id, 64);
  if (!session_id) return null;
  return {
    session_id,
    condition: str(e.condition, 32),  // feed file, e.g. "index02"
    tier,
    country: str(e.country, 8),
    event_type: e.event_type,
    post_id: str(e.post_id, 32),
    domain: str(e.domain, 16),       // "Political" | "Science"
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
