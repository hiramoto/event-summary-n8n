import { validateEventEnvelope } from './validation.js';

function writeJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}

export function createHandler({ repository, bearerToken }) {
  return async function handler(req, res) {
    if (req.method === 'GET' && req.url === '/healthz') {
      try {
        await repository.healthcheck();
        return writeJson(res, 200, { ok: true });
      } catch {
        return writeJson(res, 503, { ok: false });
      }
    }

    if (req.method === 'POST' && req.url === '/events') {
      const authHeader = req.headers.authorization ?? '';
      if (authHeader !== `Bearer ${bearerToken}`) {
        return writeJson(res, 401, { error: 'unauthorized' });
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return writeJson(res, 400, { error: 'invalid_json' });
      }

      const errors = validateEventEnvelope(body);
      if (errors.length > 0) {
        return writeJson(res, 400, { error: 'validation_error', details: errors });
      }

      try {
        const { inserted } = await repository.insertEvent(body);
        return writeJson(res, 200, { ok: true, duplicate: !inserted });
      } catch {
        return writeJson(res, 500, { error: 'internal_error' });
      }
    }

    return writeJson(res, 404, { error: 'not_found' });
  };
}
