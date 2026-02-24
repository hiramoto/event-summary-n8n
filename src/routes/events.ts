import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";

const eventSchema = z.object({
  event_id: z.string().uuid(),
  type: z.string().min(1),
  ts: z.string().datetime({ offset: true }),
  payload: z.record(z.unknown()),
  device_id: z.string().min(1).optional(),
  meta: z.record(z.unknown()).optional().default({})
});

const listQuerySchema = z.object({
  unprocessed_only: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().positive().max(500).default(100)
});

export const eventsRoute: FastifyPluginAsync = async (app) => {
  app.post("/events", async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid event payload",
        issues: parsed.error.issues
      });
    }

    const event = parsed.data;

    await prisma.event.upsert({
      where: { eventId: event.event_id },
      update: {},
      create: {
        eventId: event.event_id,
        type: event.type,
        ts: new Date(event.ts),
        payload: event.payload as Prisma.InputJsonValue,
        deviceId: event.device_id,
        meta: event.meta as Prisma.InputJsonValue
      }
    });

    return reply.code(200).send({ ok: true, event_id: event.event_id });
  });

  app.get("/events", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid query",
        issues: parsed.error.issues
      });
    }

    const query = parsed.data;

    const events = await prisma.event.findMany({
      where: query.unprocessed_only ? { processedAt: null } : undefined,
      orderBy: { ts: "desc" },
      take: query.limit
    });

    return reply.send({
      count: events.length,
      events: events.map((event) => ({
        event_id: event.eventId,
        type: event.type,
        ts: event.ts.toISOString(),
        payload: event.payload,
        device_id: event.deviceId,
        meta: event.meta,
        received_at: event.receivedAt.toISOString(),
        processed_at: event.processedAt?.toISOString() ?? null
      }))
    });
  });
};
