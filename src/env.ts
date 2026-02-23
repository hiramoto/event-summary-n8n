import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  EVENT_API_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1)
});

export const env = envSchema.parse(process.env);
