import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateLocationEvents,
  buildDigestMessage,
  generateDigest,
  buildOpenClawPayload,
} from "../scripts/digest-worker.js";

// --- Test data ---

function makeEvent(
  overrides: Partial<{
    event_id: string;
    type: string;
    ts: string;
    payload: Record<string, unknown>;
  }> = {}
) {
  return {
    event_id: overrides.event_id ?? crypto.randomUUID(),
    type: overrides.type ?? "location",
    ts: overrides.ts ?? "2025-02-23T10:00:00+09:00",
    payload: overrides.payload ?? {
      event: "enter",
      place_id: "office",
    },
    device_id: "android-main",
    meta: null,
    processed_at: null,
  };
}

// --- aggregateLocationEvents ---

test("aggregateLocationEvents returns empty for no events", () => {
  const result = aggregateLocationEvents([]);
  assert.equal(result.segments.length, 0);
  assert.equal(result.eventIds.length, 0);
});

test("aggregateLocationEvents creates segment from enter + exit", () => {
  const events = [
    makeEvent({
      event_id: "aaa-1",
      ts: "2025-02-23T10:00:00+09:00",
      payload: { event: "enter", place_id: "home" },
    }),
    makeEvent({
      event_id: "aaa-2",
      ts: "2025-02-23T10:30:00+09:00",
      payload: { event: "exit", place_id: "home" },
    }),
  ];

  const { segments, eventIds } = aggregateLocationEvents(events);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].place_id, "home");
  assert.equal(segments[0].duration_min, 30);
  assert.equal(eventIds.length, 2);
});

test("aggregateLocationEvents handles enter without exit", () => {
  const events = [
    makeEvent({
      event_id: "bbb-1",
      ts: "2025-02-23T10:00:00+09:00",
      payload: { event: "enter", place_id: "office" },
    }),
  ];

  const { segments } = aggregateLocationEvents(events);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].place_id, "office");
  assert.equal(segments[0].exit_at, null);
  assert.equal(segments[0].duration_min, null);
});

test("aggregateLocationEvents handles multiple segments", () => {
  const events = [
    makeEvent({
      event_id: "ccc-1",
      ts: "2025-02-23T08:00:00+09:00",
      payload: { event: "enter", place_id: "home" },
    }),
    makeEvent({
      event_id: "ccc-2",
      ts: "2025-02-23T09:00:00+09:00",
      payload: { event: "exit", place_id: "home" },
    }),
    makeEvent({
      event_id: "ccc-3",
      ts: "2025-02-23T09:30:00+09:00",
      payload: { event: "enter", place_id: "office" },
    }),
    makeEvent({
      event_id: "ccc-4",
      ts: "2025-02-23T18:00:00+09:00",
      payload: { event: "exit", place_id: "office" },
    }),
  ];

  const { segments } = aggregateLocationEvents(events);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].place_id, "home");
  assert.equal(segments[0].duration_min, 60);
  assert.equal(segments[1].place_id, "office");
  assert.equal(segments[1].duration_min, 510); // 8.5 hours
});

test("aggregateLocationEvents absorbs dwell into current segment", () => {
  const events = [
    makeEvent({
      event_id: "ddd-1",
      ts: "2025-02-23T10:00:00+09:00",
      payload: { event: "enter", place_id: "office" },
    }),
    makeEvent({
      event_id: "ddd-2",
      ts: "2025-02-23T10:15:00+09:00",
      payload: { event: "dwell", place_id: "office" },
    }),
    makeEvent({
      event_id: "ddd-3",
      ts: "2025-02-23T10:30:00+09:00",
      payload: { event: "exit", place_id: "office" },
    }),
  ];

  const { segments, eventIds } = aggregateLocationEvents(events);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].place_id, "office");
  assert.equal(segments[0].duration_min, 30);
  assert.equal(eventIds.length, 3);
});

test("aggregateLocationEvents skips non-location events", () => {
  const events = [
    makeEvent({
      event_id: "eee-1",
      type: "email",
      ts: "2025-02-23T10:00:00+09:00",
      payload: { subject: "test", from: "a@b.com" },
    }),
    makeEvent({
      event_id: "eee-2",
      type: "location",
      ts: "2025-02-23T10:00:00+09:00",
      payload: { event: "enter", place_id: "home" },
    }),
  ];

  const { segments, eventIds } = aggregateLocationEvents(events);

  assert.equal(segments.length, 1);
  assert.equal(eventIds.length, 1); // only location event
});

// --- buildDigestMessage ---

test("buildDigestMessage returns empty message for no segments", () => {
  const msg = buildDigestMessage([]);
  assert.equal(msg, "[LocationDigest] イベントなし");
});

test("buildDigestMessage formats single arrival segment", () => {
  const msg = buildDigestMessage([
    {
      place_id: "office",
      enter_at: "2025-02-23T10:30:00+09:00",
      exit_at: null,
      duration_min: null,
    },
  ]);

  assert.ok(msg.includes("[LocationDigest]"));
  assert.ok(msg.includes("office到着"));
});

test("buildDigestMessage formats enter-exit segment with arrow", () => {
  const msg = buildDigestMessage([
    {
      place_id: "home",
      enter_at: "2025-02-23T08:00:00+09:00",
      exit_at: "2025-02-23T09:00:00+09:00",
      duration_min: 60,
    },
    {
      place_id: "office",
      enter_at: "2025-02-23T09:30:00+09:00",
      exit_at: null,
      duration_min: null,
    },
  ]);

  assert.ok(msg.includes("[LocationDigest]"));
  assert.ok(msg.includes("→"));
  assert.ok(msg.includes("home"));
  assert.ok(msg.includes("office"));
});

// --- generateDigest ---

test("generateDigest returns null for empty events", () => {
  const result = generateDigest([]);
  assert.equal(result, null);
});

test("generateDigest produces valid digest", () => {
  const events = [
    makeEvent({
      event_id: "fff-1",
      ts: "2025-02-23T10:00:00+09:00",
      payload: { event: "enter", place_id: "office" },
    }),
    makeEvent({
      event_id: "fff-2",
      ts: "2025-02-23T10:30:00+09:00",
      payload: { event: "exit", place_id: "office" },
    }),
  ];

  const digest = generateDigest(events);

  assert.ok(digest);
  assert.ok(digest.digest_id);
  assert.ok(digest.message.includes("[LocationDigest]"));
  assert.equal(digest.payload.type, "location");
  assert.equal(digest.payload.segments.length, 1);
  assert.equal(digest.payload.event_ids.length, 2);
  assert.ok(digest.payload.period_start);
  assert.ok(digest.payload.period_end);
});

test("generateDigest includes non-location event counts", () => {
  const events = [
    makeEvent({
      event_id: "ggg-1",
      type: "location",
      ts: "2025-02-23T10:00:00+09:00",
      payload: { event: "enter", place_id: "home" },
    }),
    makeEvent({
      event_id: "ggg-2",
      type: "email",
      ts: "2025-02-23T10:05:00+09:00",
      payload: { subject: "test", from: "a@b.com" },
    }),
    makeEvent({
      event_id: "ggg-3",
      type: "todo",
      ts: "2025-02-23T10:10:00+09:00",
      payload: { task_id: "t1", old_status: "pending", new_status: "done" },
    }),
  ];

  const digest = generateDigest(events);

  assert.ok(digest);
  assert.ok(digest.message.includes("メール1件"));
  assert.ok(digest.message.includes("タスク変更1件"));
  assert.equal(digest.payload.event_ids.length, 3);
});

// --- buildOpenClawPayload ---

test("buildOpenClawPayload returns correct structure", () => {
  const digest = generateDigest([
    makeEvent({
      event_id: "hhh-1",
      ts: "2025-02-23T10:00:00+09:00",
      payload: { event: "enter", place_id: "office" },
    }),
  ]);

  assert.ok(digest);

  const payload = buildOpenClawPayload(digest);

  assert.equal(payload.name, "EventDigest");
  assert.equal(payload.wakeMode, "now");
  assert.equal(payload.deliver, true);
  assert.equal(payload.channel, "last");
  assert.ok(payload.message.includes(`[digest:${digest.digest_id}]`));
});
