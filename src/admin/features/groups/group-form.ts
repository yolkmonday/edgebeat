import { z } from "zod";
import { SLUG_RE } from "@shared/monitor-schema";

export const groupFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80, "Use 80 characters or fewer."),
  slug: z.string().regex(SLUG_RE, "Use lowercase letters, numbers and dashes, up to 64 characters."),
});

export type GroupFormValues = z.infer<typeof groupFormSchema>;

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
