import { legalFacts } from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { type AppDeps, createAppRouter } from "./context";

const tags = ["System"];

const LegalResponse = z
  .object({
    companyName: z.string().nullable(),
    taxId: z.string().nullable(),
    address: z.string().nullable(),
    dpoName: z.string().nullable(),
    dpoEmail: z.string().nullable(),
    serverLocation: z.string().nullable(),
    logRetention: z.string().nullable(),
    backupRetentionDays: z.number().int(),
    voiceRetentionDays: z.number().int(),
  })
  .openapi("LegalFacts");

const route = createRoute({
  method: "get",
  path: "/legal",
  tags,
  summary: "The company details the legal pages fill in",
  description:
    "Public, nothing secret. The Terms of Use and the Privacy Policy (`/termos`, `/privacidade`) read this to fill the fields that belong to the company that runs the installation (`LEGAL_*`). A field the server has no setting for is null, and the pages show `[a preencher]` in its place. Not the text of the documents: that ships with the app, from `docs/legal/`.",
  responses: { 200: { description: "OK", content: { "application/json": { schema: LegalResponse } } } },
});

/** The Terms of Use and the Privacy Policy: what the server fills into them. */
export function legalRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);

  app.openapi(route, async (c) => c.json(legalFacts(deps.config), 200));
  return app;
}
