import assert from "node:assert/strict";
import test from "node:test";

const sampleEvent = {
  event_id: "550e8400-e29b-41d4-a716-446655440000",
  type: "location",
  ts: "2025-02-23T10:30:00+09:00",
  payload: {
    event: "enter",
    place_id: "office",
    lat: 34.855,
    lng: 136.381,
    accuracy_m: 15,
  },
  device_id: "android-main",
  meta: { source: "tasker" },
};

type CreateManyArgs = {
  data: {
    eventId: string;
  };
};

async function withApp(
  fn: (
    app: Awaited<ReturnType<typeof import("../src/app.js")>["buildApp"]>
  ) => Promise<void>
) {
  process.env.EVENT_API_TOKEN = "secret";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/eventdb";

  const { buildApp } = await import("../src/app.js");
  const { prisma } = await import("../src/db.js");

  const seen = new Set<string>();
  const originalCreateMany = prisma.event.createMany.bind(prisma.event);

  prisma.event.createMany = (async (args: CreateManyArgs) => {
    if (seen.has(args.data.eventId)) {
      return { count: 0 };
    }

    seen.add(args.data.eventId);
    return { count: 1 };
  }) as typeof prisma.event.createMany;

  const app = buildApp();

  try {
    await fn(app);
  } finally {
    prisma.event.createMany = originalCreateMany;
    await app.close();
  }
}

// --- Health check ---

test("GET /healthz returns ok without token", async () => {
  await withApp(async (app) => {
    const res = await app.inject({ method: "GET", url: "/healthz" });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
  });
});

// --- Auth ---

test("POST /events rejects when bearer token is missing", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sampleEvent,
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { message: "Missing bearer token" });
  });
});

// --- POST /events ---

test("POST /events accepts valid payload and de-duplicates", async () => {
  await withApp(async (app) => {
    const first = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: sampleEvent,
    });

    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), {
      ok: true,
      event_id: sampleEvent.event_id,
      duplicate: false,
    });

    const second = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: sampleEvent,
    });

    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), {
      ok: true,
      event_id: sampleEvent.event_id,
      duplicate: true,
    });
  });
});

test("POST /events validates request body", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: { ...sampleEvent, event_id: "bad-uuid" },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.message, "Invalid event payload");
    assert.ok(Array.isArray(body.issues));
  });
});

// --- Event type validation (Phase 3) ---

test("POST /events rejects unsupported event type", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: { ...sampleEvent, type: "unknown_type" },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.message, "Invalid event payload");
  });
});

test("POST /events validates location payload", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: {
        ...sampleEvent,
        event_id: "550e8400-e29b-41d4-a716-446655440001",
        payload: { event: "invalid_event", place_id: "office" },
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.message, "Invalid payload for type 'location'");
    assert.ok(Array.isArray(body.issues));
  });
});

test("POST /events accepts valid email event", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: {
        event_id: "550e8400-e29b-41d4-a716-446655440002",
        type: "email",
        ts: "2025-02-23T10:30:00+09:00",
        payload: {
          subject: "Meeting reminder",
          from: "boss@example.com",
          labels: ["work", "meeting"],
        },
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.duplicate, false);
  });
});

test("POST /events validates email payload requires subject", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: {
        event_id: "550e8400-e29b-41d4-a716-446655440003",
        type: "email",
        ts: "2025-02-23T10:30:00+09:00",
        payload: { from: "someone@example.com" },
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.message, "Invalid payload for type 'email'");
  });
});

test("POST /events accepts valid todo event", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: {
        event_id: "550e8400-e29b-41d4-a716-446655440004",
        type: "todo",
        ts: "2025-02-23T10:30:00+09:00",
        payload: {
          task_id: "task-123",
          old_status: "pending",
          new_status: "done",
        },
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
  });
});

test("POST /events accepts valid vital event", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: {
        event_id: "550e8400-e29b-41d4-a716-446655440005",
        type: "vital",
        ts: "2025-02-23T10:30:00+09:00",
        payload: { sub_type: "wake" },
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
  });
});

test("POST /events rejects invalid vital sub_type", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: {
        event_id: "550e8400-e29b-41d4-a716-446655440006",
        type: "vital",
        ts: "2025-02-23T10:30:00+09:00",
        payload: { sub_type: "invalid_type" },
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.message, "Invalid payload for type 'vital'");
  });
});
