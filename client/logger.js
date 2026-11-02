// Feed-side event logger. Add to index.html AFTER your existing feed script,
// or merge into it. Keeps your Qualtrics postMessage stream; MongoDB becomes the
// full event-level trace (every tap, with timestamps and order).
//
// Per-tier links (one per Qualtrics condition, iframe src):
//   https://<user>.github.io/<repo>/?tier=1&rid=${e://Field/ResponseID}&c=US
//   https://<user>.github.io/<repo>/?tier=2&rid=${e://Field/ResponseID}&c=US
//   ... tier=3, tier=4  (c=BD for the Bangladesh sample)

(function () {
  const ENDPOINT = "https://<your-vercel-project>.vercel.app/api/log";
  const qs = new URLSearchParams(location.search);

  const TIER = Number(qs.get("tier"));
  const SESSION = qs.get("rid") || "preview-" + Math.random().toString(36).slice(2, 10);
  const COUNTRY = qs.get("c") || null;
  const T0 = performance.now();

  if (![1, 2, 3, 4].includes(TIER)) console.warn("Missing/invalid ?tier= in URL");

  let seq = 0;
  let buffer = [];

  function log(event_type, fields = {}) {
    buffer.push({
      session_id: SESSION,
      tier: TIER,
      country: COUNTRY,
      event_type,
      seq: seq++,
      ts_client: Date.now(),
      t_rel_ms: Math.round(performance.now() - T0),
      ...fields, // post_id, domain, position, value, duration_ms
    });
    if (buffer.length >= 25) flush();
  }

  function flush(useBeacon = false) {
    if (!buffer.length) return;
    const payload = JSON.stringify({ events: buffer });
    buffer = [];
    // text/plain = "simple" CORS request; works with sendBeacon on page exit
    const blob = new Blob([payload], { type: "text/plain" });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, blob);
    } else {
      fetch(ENDPOINT, { method: "POST", body: blob, keepalive: true }).catch(() => {});
    }
  }

  setInterval(flush, 5000);
  addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });

  window.FeedLog = { log, flush, TIER, SESSION };
})();

/* ---------------------------------------------------------------
   Where to call FeedLog.log() in your existing handlers
   (p = the post object: {id, domain}; pos = its 1-12 shown position)

   feed render:          FeedLog.log("feed_start")
   IntersectionObserver
     entering view:      FeedLog.log("post_view", {post_id:p.id, domain:p.domain, position:pos})
     leaving view:       FeedLog.log("dwell", {post_id:p.id, domain:p.domain, position:pos, duration_ms:ms})
   "cr" badge tap:       FeedLog.log("badge_tap", {post_id:p.id, domain:p.domain, position:pos})
   modal opened:         FeedLog.log("modal_open", {post_id:p.id, position:pos})
   modal closed:         FeedLog.log("modal_close", {post_id:p.id, position:pos, duration_ms:ms})
   learn more:           FeedLog.log("learn_more", {post_id:p.id, position:pos})
   like/save/share:      FeedLog.log("like", {post_id:p.id, domain:p.domain, position:pos, value:isOn})
   feed_complete:        FeedLog.log("feed_complete"); FeedLog.flush(true);
---------------------------------------------------------------- */
