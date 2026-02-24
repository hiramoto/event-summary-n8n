import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const placeSchema = z.object({
  place_id: z.string().min(1).max(100),
  label: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radius_m: z.number().int().positive().default(100),
});

export const placesRoute: FastifyPluginAsync = async (app) => {
  app.get("/places", async (_request, reply) => {
    const places = await prisma.place.findMany({
      orderBy: { createdAt: "asc" },
    });

    return reply.send({
      count: places.length,
      places: places.map((p) => ({
        place_id: p.placeId,
        label: p.label,
        lat: p.lat,
        lng: p.lng,
        radius_m: p.radiusM,
        created_at: p.createdAt.toISOString(),
      })),
    });
  });

  app.post("/places", async (request, reply) => {
    const parsed = placeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid place payload",
        issues: parsed.error.issues,
      });
    }

    const place = parsed.data;

    const existing = await prisma.place.findUnique({
      where: { placeId: place.place_id },
    });

    if (existing) {
      const updated = await prisma.place.update({
        where: { placeId: place.place_id },
        data: {
          label: place.label,
          lat: place.lat,
          lng: place.lng,
          radiusM: place.radius_m,
        },
      });

      return reply.code(200).send({
        ok: true,
        place_id: updated.placeId,
        updated: true,
      });
    }

    await prisma.place.create({
      data: {
        placeId: place.place_id,
        label: place.label,
        lat: place.lat,
        lng: place.lng,
        radiusM: place.radius_m,
      },
    });

    return reply.code(201).send({
      ok: true,
      place_id: place.place_id,
      updated: false,
    });
  });

  app.delete("/places/:placeId", async (request, reply) => {
    const placeId = (request.params as { placeId?: string }).placeId;

    if (!placeId) {
      return reply.code(400).send({ message: "Missing place_id" });
    }

    const existing = await prisma.place.findUnique({
      where: { placeId },
    });

    if (!existing) {
      return reply.code(404).send({ message: "Place not found" });
    }

    await prisma.place.delete({ where: { placeId } });

    return reply.send({ ok: true, place_id: placeId });
  });
};
