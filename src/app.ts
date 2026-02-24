import Fastify from "fastify";
import { env } from "./env.js";
import { eventsRoute } from "./routes/events.js";
import { placesRoute } from "./routes/places.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/healthz") {
      return;
    }

    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({ message: "Missing bearer token" });
    }

    const token = authHeader.slice("Bearer ".length);

    if (token !== env.EVENT_API_TOKEN) {
      return reply.code(401).send({ message: "Invalid bearer token" });
    }
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.register(eventsRoute);
  app.register(placesRoute);

  return app;
}
