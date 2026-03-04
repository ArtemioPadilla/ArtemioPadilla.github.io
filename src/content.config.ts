import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string().max(120),
    description: z.string().max(300),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    heroImage: z.string().optional(),
    heroAlt: z.string().optional(),
  }),
});

const lab = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/lab" }),
  schema: z.object({
    title: z.string().max(100),
    description: z.string().max(300),
    icon: z.string(),
    tags: z.array(z.string()).default([]),
    status: z.enum(["alpha", "beta", "stable"]).default("alpha"),
    featured: z.boolean().default(false),
    order: z.number().default(0),
    componentSlug: z.string(),
    requiresCustomPage: z.boolean().default(false),
    draft: z.boolean().default(false),
    createdDate: z.coerce.date(),
    // Future auth (documented, not implemented):
    // access: z.enum(["public", "private"]).default("public"),
    // requiredRole: z.string().optional(),
  }),
});

export const collections = { blog, lab };
