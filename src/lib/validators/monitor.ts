"use strict";

import { z } from "zod";
import { isIP } from "net";

const portsSchema = z
  .array(z.number().int().min(1).max(65535))
  .nonempty()
  .default([80, 443]);

const ipStringSchema = z
  .string()
  .refine((value) => isIP(value) !== 0, { message: "IP inválido" });

export const monitorCreateSchema = z.object({
  ip_address: ipStringSchema,
  nickname: z.string().min(1),
  ping_interval_seconds: z.number().int().min(60).max(86400).default(60),
  failure_threshold: z.number().int().min(1).default(2),
  ports: portsSchema.optional(),
  is_active: z.boolean().default(true).optional(),
});

export const monitorPatchSchema = z
  .object({
    ip_address: ipStringSchema.optional(),
    nickname: z.string().min(1).optional(),
    ping_interval_seconds: z.number().int().min(60).max(86400).optional(),
    failure_threshold: z.number().int().min(1).optional(),
    ports: portsSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });
