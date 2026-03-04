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
    accuracy_m: 15
  },
  device_id: "android-main",
  meta: { source: "tasker" }
};

type CreateManyArgs = {
  data: {
    eventId: string;
  };
};

type DigestCreateManyArgs = {
  data: {
    digestId: string;
    payload: Record<string, unknown>;
    message?: string;
  };
};

type DigestFindManyArgs = {
  where?: {
    sentAt?: null;
  };
  take: number;
};

type DigestFindUniqueArgs = {
  where: {
    digestId: string;
  };
};

type DigestUpdateArgs = {
  where: {
    digestId: string;
  };
  data: {
    sentAt: Date;
  };
};

type StubDigest = {
  digestId: string;
  payload: Record<string, unknown>;
  message: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

async function withApp(fn: (app: Awaited<ReturnType<typeof import("../src/app.js")>["buildApp"]>) => Promise<void>) {
  process.env.EVENT_API_TOKEN = "secret";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/eventdb";

  const { buildApp } = await import("../src/app.js");
  const { prisma } = await import("../src/db.js");

  const seen = new Set<string>();
  const digests = new Map<string, StubDigest>();
  const originalCreateMany = prisma.event.createMany.bind(prisma.event);
  const originalDigestCreateMany = (prisma as any).digest.createMany.bind((prisma as any).digest);
  const originalDigestFindMany = (prisma as any).digest.findMany.bind((prisma as any).digest);
  const originalDigestFindUnique = (prisma as any).digest.findUnique.bind((prisma as any).digest);
  const originalDigestUpdate = (prisma as any).digest.update.bind((prisma as any).digest);

  prisma.event.createMany = (async (args: CreateManyArgs) => {
    if (seen.has(args.data.eventId)) {
      return { count: 0 };
    }

    seen.add(args.data.eventId);
    return { count: 1 };
  }) as typeof prisma.event.createMany;

  (prisma as any).digest.createMany = (async (args: DigestCreateManyArgs) => {
    if (digests.has(args.data.digestId)) {
      return { count: 0 };
    }

    digests.set(args.data.digestId, {
      digestId: args.data.digestId,
      payload: args.data.payload,
      message: args.data.message ?? null,
      createdAt: new Date(),
      sentAt: null
    });

    return { count: 1 };
  }) as any;

  (prisma as any).digest.findMany = (async (args: DigestFindManyArgs) => {
    const values = Array.from(digests.values())
      .filter((digest) => (args.where?.sentAt === null ? digest.sentAt === null : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, args.take);

    return values;
  }) as any;

  (prisma as any).digest.findUnique = (async (args: DigestFindUniqueArgs) => {
    return digests.get(args.where.digestId) ?? null;
  }) as any;

  (prisma as any).digest.update = (async (args: DigestUpdateArgs) => {
    const current = digests.get(args.where.digestId);

    if (!current) {
      throw new Error("Digest not found");
    }

    const updated: StubDigest = { ...current, sentAt: args.data.sentAt };
    digests.set(args.where.digestId, updated);
    return updated;
  }) as any;

  const app = buildApp();

  try {
    await fn(app);
  } finally {
    prisma.event.createMany = originalCreateMany;
    (prisma as any).digest.createMany = originalDigestCreateMany;
    (prisma as any).digest.findMany = originalDigestFindMany;
    (prisma as any).digest.findUnique = originalDigestFindUnique;
    (prisma as any).digest.update = originalDigestUpdate;
    await app.close();
  }
}

test("GET /healthz returns ok without token", async () => {
  await withApp(async (app) => {
    const res = await app.inject({ method: "GET", url: "/healthz" });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
  });
});

test("POST /events rejects when bearer token is missing", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: sampleEvent
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { message: "Missing bearer token" });
  });
});

test("POST /events accepts valid payload and de-duplicates", async () => {
  await withApp(async (app) => {
    const first = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: sampleEvent
    });

    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), {
      ok: true,
      event_id: sampleEvent.event_id,
      duplicate: false
    });

    const second = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: sampleEvent
    });

    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), {
      ok: true,
      event_id: sampleEvent.event_id,
      duplicate: true
    });
  });
});

test("POST /events validates request body", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: "Bearer secret" },
      payload: { ...sampleEvent, event_id: "bad-uuid" }
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.message, "Invalid event payload");
    assert.ok(Array.isArray(body.issues));
  });
});

test("POST /digests accepts valid payload and de-duplicates", async () => {
  await withApp(async (app) => {
    const digestPayload = {
      digest_id: "550e8400-e29b-41d4-a716-446655440010",
      payload: { summary: "今日の要約" },
      message: "Digest ready"
    };

    const first = await app.inject({
      method: "POST",
      url: "/digests",
      headers: { authorization: "Bearer secret" },
      payload: digestPayload
    });

    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), {
      ok: true,
      digest_id: digestPayload.digest_id,
      duplicate: false
    });

    const second = await app.inject({
      method: "POST",
      url: "/digests",
      headers: { authorization: "Bearer secret" },
      payload: digestPayload
    });

    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), {
      ok: true,
      digest_id: digestPayload.digest_id,
      duplicate: true
    });
  });
});

test("GET /digests honors unsent_only and limit", async () => {
  await withApp(async (app) => {
    const headers = { authorization: "Bearer secret" };

    await app.inject({
      method: "POST",
      url: "/digests",
      headers,
      payload: {
        digest_id: "550e8400-e29b-41d4-a716-446655440021",
        payload: { idx: 1 },
        message: "first"
      }
    });

    await app.inject({
      method: "POST",
      url: "/digests",
      headers,
      payload: {
        digest_id: "550e8400-e29b-41d4-a716-446655440022",
        payload: { idx: 2 },
        message: "second"
      }
    });

    await app.inject({
      method: "POST",
      url: "/digests/550e8400-e29b-41d4-a716-446655440021/sent",
      headers,
      payload: {
        sent_at: "2025-02-23T12:00:00+09:00"
      }
    });

    const unsentOnly = await app.inject({
      method: "GET",
      url: "/digests?unsent_only=true&limit=5",
      headers
    });

    assert.equal(unsentOnly.statusCode, 200);
    const unsentBody = unsentOnly.json();
    assert.equal(unsentBody.count, 1);
    assert.equal(unsentBody.digests[0].digest_id, "550e8400-e29b-41d4-a716-446655440022");

    const limited = await app.inject({
      method: "GET",
      url: "/digests?limit=1",
      headers
    });

    assert.equal(limited.statusCode, 200);
    const limitedBody = limited.json();
    assert.equal(limitedBody.count, 1);
    assert.equal(limitedBody.digests.length, 1);
  });
});

test("POST /digests/:digestId/sent updates digest when valid", async () => {
  await withApp(async (app) => {
    const headers = { authorization: "Bearer secret" };
    const digestId = "550e8400-e29b-41d4-a716-446655440031";

    await app.inject({
      method: "POST",
      url: "/digests",
      headers,
      payload: {
        digest_id: digestId,
        payload: { summary: "ready" }
      }
    });

    const res = await app.inject({
      method: "POST",
      url: `/digests/${digestId}/sent`,
      headers,
      payload: {
        sent_at: "2025-02-23T14:30:00+09:00"
      }
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      ok: true,
      digest_id: digestId,
      sent_at: "2025-02-23T05:30:00.000Z"
    });
  });
});

test("POST /digests/:digestId/sent rejects invalid uuid", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/digests/not-a-uuid/sent",
      headers: { authorization: "Bearer secret" },
      payload: {}
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { message: "Invalid digest id" });
  });
});

test("POST /digests/:digestId/sent returns 404 for unknown digest", async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: "POST",
      url: "/digests/550e8400-e29b-41d4-a716-446655440099/sent",
      headers: { authorization: "Bearer secret" },
      payload: {}
    });

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { message: "Digest not found" });
  });
});

test("POST /digests/:digestId/sent validates sent_at", async () => {
  await withApp(async (app) => {
    const headers = { authorization: "Bearer secret" };
    const digestId = "550e8400-e29b-41d4-a716-446655440041";

    await app.inject({
      method: "POST",
      url: "/digests",
      headers,
      payload: {
        digest_id: digestId,
        payload: { summary: "ready" }
      }
    });

    const res = await app.inject({
      method: "POST",
      url: `/digests/${digestId}/sent`,
      headers,
      payload: {
        sent_at: "invalid-date"
      }
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.message, "Invalid payload");
    assert.ok(Array.isArray(body.issues));
  });
});
