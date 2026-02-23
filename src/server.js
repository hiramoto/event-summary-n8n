import http from 'node:http';
import { InMemoryEventRepository } from './db.js';
import { createHandler } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const eventApiToken = process.env.EVENT_API_TOKEN;

if (!eventApiToken) {
  throw new Error('EVENT_API_TOKEN is required');
}

const repository = new InMemoryEventRepository();
const handler = createHandler({ repository, bearerToken: eventApiToken });

const server = http.createServer((req, res) => {
  handler(req, res);
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Event API listening on :${port}`);
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`${signal} received, shutting down...`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
