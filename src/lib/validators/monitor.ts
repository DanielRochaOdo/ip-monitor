"use strict";

import { z } from "zod";
import { isIP } from "net";

const portsSchema = z.array(z.number().int().min(1).max(65535)).nonempty().default([80, 443]);

const ipStringSchema = z
  .string()
  .refine((value) => isIP(value) !== 0, { message: "IP invalido" });

export const monitorCreateSchema = z
  .object({
    ip_address: ipStringSchema,
    nickname: z.string().min(1),
    ping_interval_seconds: z.number().int().min(60).max(86400).default(60),
    failure_threshold: z.number().int().min(1).default(2),
    success_threshold: z.number().int().min(1).default(1).optional(),
    check_type: z.enum(["TCP", "HTTP", "ICMP"]).default("TCP").optional(),
    agent_id: z.string().uuid().nullable().optional(),
    ports: portsSchema.optional(),
    port: z.number().int().min(1).max(65535).nullable().optional(),
    http_url: z.string().url().nullable().optional(),
    http_method: z.enum(["GET", "HEAD"]).default("GET").optional(),
    http_expected_status: z.number().int().min(100).max(599).default(200).optional(),
    is_private: z.boolean().default(false).optional(),
    is_active: z.boolean().default(true).optional(),
  })
  .superRefine((data, ctx) => {
    const checkType = data.check_type ?? "TCP";
    if (checkType === "HTTP" && !data.http_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "http_url e obrigatorio quando check_type=HTTP",
        path: ["http_url"],
      });
    }
  });

export const monitorPatchSchema = z
  .object({
    ip_address: ipStringSchema.optional(),
    nickname: z.string().min(1).optional(),
    ping_interval_seconds: z.number().int().min(60).max(86400).optional(),
    failure_threshold: z.number().int().min(1).optional(),
    success_threshold: z.number().int().min(1).optional(),
    check_type: z.enum(["TCP", "HTTP", "ICMP"]).optional(),
    agent_id: z.string().uuid().nullable().optional(),
    ports: portsSchema.optional(),
    port: z.number().int().min(1).max(65535).nullable().optional(),
    http_url: z.string().url().nullable().optional(),
    http_method: z.enum(["GET", "HEAD"]).optional(),
    http_expected_status: z.number().int().min(100).max(599).optional(),
    is_private: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

