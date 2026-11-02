// Run in mongosh (Atlas > Connect > Shell) against database c2pa_feed.
// Participant x post x tier table -> export to CSV for the lme4 Tier x Position model.

use("c2pa_feed");

// 1) Indexes (run once)
db.events.createIndex({ session_id: 1, seq: 1 });
db.events.createIndex({ tier: 1, event_type: 1 });

// 2) Per-participant, per-post behaviour
db.events.aggregate([
  { $match: { post_id: { $ne: null } } },
  { $group: {
      _id: { session_id: "$session_id", tier: "$tier", post_id: "$post_id" },
      country:      { $first: "$country" },
      domain:       { $first: "$domain" },
      position:     { $first: "$position" },
      dwell_ms:     { $sum: { $cond: [{ $eq: ["$event_type", "dwell"] }, "$duration_ms", 0] } },
      badge_taps:   { $sum: { $cond: [{ $eq: ["$event_type", "badge_tap"] }, 1, 0] } },
      modal_ms:     { $sum: { $cond: [{ $eq: ["$event_type", "modal_close"] }, "$duration_ms", 0] } },
      learn_more:   { $sum: { $cond: [{ $eq: ["$event_type", "learn_more"] }, 1, 0] } },
      // last state wins for toggles
      toggles:      { $push: { t: "$event_type", v: "$value", s: "$seq" } }
  } },
  { $addFields: {
      liked:  { $let: { vars: { x: { $last: { $sortArray: { input: { $filter: { input: "$toggles", cond: { $eq: ["$$this.t", "like"] } } }, sortBy: { s: 1 } } } } }, in: { $ifNull: ["$$x.v", false] } } },
      saved:  { $let: { vars: { x: { $last: { $sortArray: { input: { $filter: { input: "$toggles", cond: { $eq: ["$$this.t", "save"] } } }, sortBy: { s: 1 } } } } }, in: { $ifNull: ["$$x.v", false] } } },
      shared: { $let: { vars: { x: { $last: { $sortArray: { input: { $filter: { input: "$toggles", cond: { $eq: ["$$this.t", "share"] } } }, sortBy: { s: 1 } } } } }, in: { $ifNull: ["$$x.v", false] } } }
  } },
  { $project: { toggles: 0 } },
  { $out: "post_level" }
]);

// 3) Quick check by tier
db.post_level.aggregate([
  { $group: { _id: "$tier",
      participants: { $addToSet: "$_id.session_id" },
      badge_tap_rate: { $avg: { $cond: [{ $gt: ["$badge_taps", 0] }, 1, 0] } },
      mean_dwell_s:   { $avg: { $divide: ["$dwell_ms", 1000] } } } },
  { $project: { n: { $size: "$participants" }, badge_tap_rate: 1, mean_dwell_s: 1 } },
  { $sort: { _id: 1 } }
]);

// 4) Export for R (terminal):
// mongoexport --uri "$MONGODB_URI" --collection post_level --type csv \
//   --fields _id.session_id,_id.tier,_id.post_id,country,domain,position,dwell_ms,badge_taps,modal_ms,learn_more,liked,saved,shared \
//   --out post_level.csv
