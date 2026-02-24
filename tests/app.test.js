import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../src/app.js';
import { InMemoryEventRepository } from '../src/db.js';

const sampleEvent = {
  event_id: '550e8400-e29b-41d4-a716-446655440000',
  type: 'location',
  ts: '2025-02-23T10:30:00+09:00',
  payload: {
    event: 'enter',
    place_id: 'office',
    lat: 34.855,
    lng: 136.381,
    accuracy_m: 15,
  },
  device_id: 'android-main',
  meta: { source: 'tasker' },
};

async function withServer(fn) {
  const repository = new InMemoryEventRepository();
  const handler = createHandler({ repository, bearerToken: 'secret' });
  const server = http.createServer((req, res) => handler(req, res));

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /healthz returns ok', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('POST /events rejects unauthorized', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleEvent),
    });

    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });
});

test('POST /events accepts valid envelope and de-duplicates', async () => {
  await withServer(async (baseUrl) => {
    const req = () =>
      fetch(`${baseUrl}/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret',
        },
        body: JSON.stringify(sampleEvent),
      });

    const first = await req();
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, duplicate: false });

    const second = await req();
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { ok: true, duplicate: true });
  });
});

test('POST /events validates payload', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({ ...sampleEvent, event_id: 'bad-uuid' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'validation_error');
    assert.ok(body.details.includes('event_id must be a valid UUID.'));
  });
});
