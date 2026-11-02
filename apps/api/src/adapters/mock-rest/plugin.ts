import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { type MockLocationStore, defaultMockStore } from "./store.js";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export type MockSourcePluginOpts = {
  store?: MockLocationStore;
  prefix?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockSourcePlugin: FastifyPluginAsync<MockSourcePluginOpts> = async (
  app: FastifyInstance,
  opts,
) => {
  const store = opts.store ?? defaultMockStore;

  app.get("/locations", async (request, reply) => {
    const query = querySchema.parse(request.query);
    const config = store.getConfig();
    const fault = store.consumeFault();

    if (fault === "timeout") {
      // Simulate a hung upstream: delay longer than typical client timeout budgets in tests.
      // Do not apply this delay to healthy responses.
      await sleep(config.delayMs > 0 ? config.delayMs : 5_000);
      return reply.status(504).send({ error: "gateway_timeout", message: "Simulated upstream timeout" });
    }

    if (fault === "rate_limit") {
      return reply
        .status(429)
        .header("Retry-After", String(config.rateLimitRetryAfterSeconds))
        .send({ error: "rate_limited", message: "Too many requests" });
    }

    if (fault === "malformed_json") {
      reply.header("content-type", "application/json");
      return reply.status(200).send("{ not-valid-json");
    }

    const page = store.listPage(query.cursor ?? null, query.limit ?? config.defaultPageSize);
    return {
      data: page.records,
      next_cursor: page.nextCursor,
      page_number: page.pageNumber,
      total: store.getConfig().totalRecords,
    };
  });

  app.get("/health", async () => ({ status: "ok", adapter: "mock-rest" }));
};

export async function registerMockSource(
  app: FastifyInstance,
  opts: MockSourcePluginOpts = {},
): Promise<void> {
  await app.register(mockSourcePlugin, {
    prefix: opts.prefix ?? "/mock-source",
    store: opts.store,
  });
}
