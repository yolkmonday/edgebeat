import { Hono } from "hono";
import type { Env } from "@/env";

// stub: real routes land in a later task of plan 3
export const transferApi = new Hono<{ Bindings: Env }>();
