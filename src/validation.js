const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isIsoDateString(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

export function validateEventEnvelope(body) {
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['Request body must be a JSON object.'];
  }

  if (!UUID_V4_REGEX.test(body.event_id ?? '')) {
    errors.push('event_id must be a valid UUID.');
  }

  if (typeof body.type !== 'string' || body.type.trim().length === 0) {
    errors.push('type must be a non-empty string.');
  }

  if (!isIsoDateString(body.ts)) {
    errors.push('ts must be a valid ISO-8601 timestamp string.');
  }

  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    errors.push('payload must be a JSON object.');
  }

  if (body.device_id !== undefined && typeof body.device_id !== 'string') {
    errors.push('device_id must be a string when provided.');
  }

  if (body.meta !== undefined && (!body.meta || typeof body.meta !== 'object' || Array.isArray(body.meta))) {
    errors.push('meta must be an object when provided.');
  }

  return errors;
}
