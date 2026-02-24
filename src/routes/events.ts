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

const digestSchema = z.object({
  digest_id: z.string().uuid(),
  payload: z.record(z.unknown()),
  message: z.string().min(1).optional()
});

const digestListQuerySchema = z.object({
  unsent_only: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().positive().max(500).default(100)
});

const markSentSchema = z.object({
  sent_at: z.string().datetime({ offset: true }).optional()
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

    const result = await prisma.event.createMany({
      data: {
        eventId: event.event_id,
        type: event.type,
        ts: new Date(event.ts),
        payload: event.payload as Prisma.InputJsonValue,
        deviceId: event.device_id,
        meta: event.meta as Prisma.InputJsonValue
      },
      skipDuplicates: true
    });

    return reply.code(200).send({
      ok: true,
      event_id: event.event_id,
      duplicate: result.count === 0
    });
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

  app.post("/digests", async (request, reply) => {
    const parsed = digestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid digest payload",
        issues: parsed.error.issues
      });
    }

    const digest = parsed.data;

    const result = await (prisma as any).digest.createMany({
      data: {
        digestId: digest.digest_id,
        payload: digest.payload as Prisma.InputJsonValue,
        message: digest.message
      },
      skipDuplicates: true
    });

    return reply.code(200).send({
      ok: true,
      digest_id: digest.digest_id,
      duplicate: result.count === 0
    });
  });

  app.get("/digests", async (request, reply) => {
    const parsed = digestListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid query",
        issues: parsed.error.issues
      });
    }

    const query = parsed.data;

    const digests = await (prisma as any).digest.findMany({
      where: query.unsent_only ? { sentAt: null } : undefined,
      orderBy: { createdAt: "desc" },
      take: query.limit
    });

    return reply.send({
      count: digests.length,
      digests: digests.map((digest) => ({
        digest_id: digest.digestId,
        payload: digest.payload,
        message: digest.message,
        created_at: digest.createdAt.toISOString(),
        sent_at: digest.sentAt?.toISOString() ?? null
      }))
    });
  });

  app.post("/digests/:digestId/sent", async (request, reply) => {
    const digestId = z.string().uuid().safeParse((request.params as { digestId?: string }).digestId);
    const body = markSentSchema.safeParse(request.body ?? {});

    if (!digestId.success) {
      return reply.code(400).send({ message: "Invalid digest id" });
    }

    if (!body.success) {
      return reply.code(400).send({
        message: "Invalid payload",
        issues: body.error.issues
      });
    }

    const digest = await (prisma as any).digest.findUnique({ where: { digestId: digestId.data } });

    if (!digest) {
      return reply.code(404).send({ message: "Digest not found" });
    }

    const sentAt = body.data.sent_at ? new Date(body.data.sent_at) : new Date();

    const updated = await (prisma as any).digest.update({
      where: { digestId: digestId.data },
      data: { sentAt }
    });

    return reply.send({
      ok: true,
      digest_id: updated.digestId,
      sent_at: updated.sentAt?.toISOString() ?? null
    });
  });
};
