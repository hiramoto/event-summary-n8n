import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";

// --- Payload schemas per event type (Phase 3) ---

const locationPayloadSchema = z.object({
  event: z.enum(["enter", "exit", "dwell"]),
  place_id: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy_m: z.number().nonnegative().optional(),
});

const emailPayloadSchema = z.object({
  subject: z.string().min(1),
  from: z.string().min(1),
  labels: z.array(z.string()).optional().default([]),
});

const todoPayloadSchema = z.object({
  task_id: z.string().min(1),
  old_status: z.string().min(1),
  new_status: z.string().min(1),
});

const vitalPayloadSchema = z.object({
  sub_type: z.enum(["wake", "sleep", "exercise", "watch_off"]),
});

const payloadSchemas: Record<string, z.ZodTypeAny> = {
  location: locationPayloadSchema,
  email: emailPayloadSchema,
  todo: todoPayloadSchema,
  vital: vitalPayloadSchema,
};

const supportedTypes = ["location", "email", "todo", "vital"] as const;

// --- Common schemas ---

const eventSchema = z.object({
  event_id: z.string().uuid(),
  type: z.enum(supportedTypes),
  ts: z.string().datetime({ offset: true }),
  payload: z.record(z.unknown()),
  device_id: z.string().min(1).optional(),
  meta: z.record(z.unknown()).optional().default({}),
});

const listQuerySchema = z.object({
  unprocessed_only: z.coerce.boolean().optional().default(false),
  type: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const digestSchema = z.object({
  digest_id: z.string().uuid(),
  payload: z.record(z.unknown()),
  message: z.string().min(1).optional(),
});

const digestListQuerySchema = z.object({
  unsent_only: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const markSentSchema = z.object({
  sent_at: z.string().datetime({ offset: true }).optional(),
});

const processEventsSchema = z.object({
  event_ids: z.array(z.string().uuid()).min(1).max(1000),
});

export const eventsRoute: FastifyPluginAsync = async (app) => {
  // --- Events ---

  app.post("/events", async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid event payload",
        issues: parsed.error.issues,
      });
    }

    const event = parsed.data;

    // Validate payload against type-specific schema
    const payloadValidator = payloadSchemas[event.type];
    if (payloadValidator) {
      const payloadResult = payloadValidator.safeParse(event.payload);
      if (!payloadResult.success) {
        return reply.code(400).send({
          message: `Invalid payload for type '${event.type}'`,
          issues: payloadResult.error.issues,
        });
      }
    }

    const result = await prisma.event.createMany({
      data: {
        eventId: event.event_id,
        type: event.type,
        ts: new Date(event.ts),
        payload: event.payload as Prisma.InputJsonValue,
        deviceId: event.device_id,
        meta: event.meta as Prisma.InputJsonValue,
      },
      skipDuplicates: true,
    });

    return reply.code(200).send({
      ok: true,
      event_id: event.event_id,
      duplicate: result.count === 0,
    });
  });

  app.get("/events", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid query",
        issues: parsed.error.issues,
      });
    }

    const query = parsed.data;

    const where: Prisma.EventWhereInput = {};
    if (query.unprocessed_only) {
      where.processedAt = null;
    }
    if (query.type) {
      where.type = query.type;
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { ts: "desc" },
      take: query.limit,
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
        processed_at: event.processedAt?.toISOString() ?? null,
      })),
    });
  });

  // Mark events as processed (for n8n batch processing)
  app.post("/events/process", async (request, reply) => {
    const parsed = processEventsSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid payload",
        issues: parsed.error.issues,
      });
    }

    const { event_ids } = parsed.data;
    const now = new Date();

    const result = await prisma.event.updateMany({
      where: {
        eventId: { in: event_ids },
        processedAt: null,
      },
      data: {
        processedAt: now,
      },
    });

    return reply.send({
      ok: true,
      processed_count: result.count,
      processed_at: now.toISOString(),
    });
  });

  // --- Digests ---

  app.post("/digests", async (request, reply) => {
    const parsed = digestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid digest payload",
        issues: parsed.error.issues,
      });
    }

    const digest = parsed.data;

    const result = await prisma.digest.createMany({
      data: {
        digestId: digest.digest_id,
        payload: digest.payload as Prisma.InputJsonValue,
        message: digest.message,
      },
      skipDuplicates: true,
    });

    return reply.code(200).send({
      ok: true,
      digest_id: digest.digest_id,
      duplicate: result.count === 0,
    });
  });

  app.get("/digests", async (request, reply) => {
    const parsed = digestListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid query",
        issues: parsed.error.issues,
      });
    }

    const query = parsed.data;

    const digests = await prisma.digest.findMany({
      where: query.unsent_only ? { sentAt: null } : undefined,
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });

    return reply.send({
      count: digests.length,
      digests: digests.map((digest) => ({
        digest_id: digest.digestId,
        payload: digest.payload,
        message: digest.message,
        created_at: digest.createdAt.toISOString(),
        sent_at: digest.sentAt?.toISOString() ?? null,
      })),
    });
  });

  app.post("/digests/:digestId/sent", async (request, reply) => {
    const digestId = z
      .string()
      .uuid()
      .safeParse((request.params as { digestId?: string }).digestId);
    const body = markSentSchema.safeParse(request.body ?? {});

    if (!digestId.success) {
      return reply.code(400).send({ message: "Invalid digest id" });
    }

    if (!body.success) {
      return reply.code(400).send({
        message: "Invalid payload",
        issues: body.error.issues,
      });
    }

    const digest = await prisma.digest.findUnique({
      where: { digestId: digestId.data },
    });

    if (!digest) {
      return reply.code(404).send({ message: "Digest not found" });
    }

    const sentAt = body.data.sent_at ? new Date(body.data.sent_at) : new Date();

    const updated = await prisma.digest.update({
      where: { digestId: digestId.data },
      data: { sentAt },
    });

    return reply.send({
      ok: true,
      digest_id: updated.digestId,
      sent_at: updated.sentAt?.toISOString() ?? null,
    });
  });
};
