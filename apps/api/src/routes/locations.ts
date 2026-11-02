import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { dataSources, locations } from "../db/schema.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  category: z.string().optional(),
  sourceKey: z.string().optional(),
});

export type LocationRoutesOpts = {
  db: Database;
};

export const locationRoutes: FastifyPluginAsync<LocationRoutesOpts> = async (app, opts) => {
  app.get("/api/locations", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const conditions = [];

    if (query.q) {
      const pattern = `%${query.q}%`;
      conditions.push(
        or(
          ilike(locations.name, pattern),
          ilike(locations.externalId, pattern),
          ilike(locations.city, pattern),
          ilike(locations.addressLine1, pattern),
        ),
      );
    }
    if (query.city) conditions.push(ilike(locations.city, query.city));
    if (query.state) conditions.push(eq(locations.state, query.state.toUpperCase()));
    if (query.category) conditions.push(ilike(locations.category, query.category));
    if (query.sourceKey) {
      const source = await opts.db.query.dataSources.findFirst({
        where: eq(dataSources.key, query.sourceKey),
      });
      if (!source) {
        return { data: [], page: query.page, pageSize: query.pageSize, total: 0 };
      }
      conditions.push(eq(locations.sourceId, source.id));
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const totalRows = await opts.db.select({ total: count() }).from(locations).where(where);
    const total = totalRows[0]?.total ?? 0;

    const rows = await opts.db
      .select({
        location: locations,
        sourceKey: dataSources.key,
      })
      .from(locations)
      .innerJoin(dataSources, eq(locations.sourceId, dataSources.id))
      .where(where)
      .orderBy(desc(locations.updatedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      data: rows.map(({ location, sourceKey }) => ({
        id: location.id,
        sourceKey,
        externalId: location.externalId,
        name: location.name,
        addressLine1: location.addressLine1,
        addressLine2: location.addressLine2,
        city: location.city,
        state: location.state,
        postalCode: location.postalCode,
        country: location.country,
        phoneE164: location.phoneE164,
        websiteUrl: location.websiteUrl,
        category: location.category,
        contentHash: location.contentHash,
        sourceUpdatedAt: location.sourceUpdatedAt,
        syncedAt: location.syncedAt,
        updatedAt: location.updatedAt,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
    };
  });

  app.get("/api/locations/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const rows = await opts.db
      .select({
        location: locations,
        sourceKey: dataSources.key,
        sourceName: dataSources.name,
      })
      .from(locations)
      .innerJoin(dataSources, eq(locations.sourceId, dataSources.id))
      .where(eq(locations.id, params.id))
      .limit(1);

    const match = rows[0];
    if (!match) {
      return reply.status(404).send({ error: "not_found", message: "Location not found" });
    }

    const { location, sourceKey, sourceName } = match;
    return {
      data: {
        id: location.id,
        sourceKey,
        sourceName,
        externalId: location.externalId,
        name: location.name,
        addressLine1: location.addressLine1,
        addressLine2: location.addressLine2,
        city: location.city,
        state: location.state,
        postalCode: location.postalCode,
        country: location.country,
        phoneE164: location.phoneE164,
        websiteUrl: location.websiteUrl,
        category: location.category,
        contentHash: location.contentHash,
        sourceUpdatedAt: location.sourceUpdatedAt,
        syncedAt: location.syncedAt,
        createdAt: location.createdAt,
        updatedAt: location.updatedAt,
      },
    };
  });
};
