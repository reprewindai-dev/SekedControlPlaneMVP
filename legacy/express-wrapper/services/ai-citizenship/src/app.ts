import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { Queue, QueueEvents } from "bullmq";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { requireAuth } from "./middleware/auth";

dotenv.config();

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const citizenshipQueue = new Queue("ai-citizenship", { connection: redis });
const queueEvents = new QueueEvents("ai-citizenship", { connection: redis });
const prisma = new PrismaClient();

const app = Fastify({ logger: true });

app.register(helmet);
app.register(cors);
app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// AI Citizenship API Schemas
const issueCitizenshipSchema = z.object({
  modelType: z.enum(["llm", "agent", "robot", "autonomous_system"]),
  ownerEntity: z.string().min(1),
  jurisdiction: z.string().length(2), // ISO country code
  capabilities: z.array(z.string()).min(1),
  trustLevel: z.enum(["experimental", "supervised", "autonomous"]),
  liabilityHolder: z.string().min(1),
});

const verifyCitizenshipSchema = z.object({
  citizenshipId: z.string().min(1),
  signature: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  challenge: z.string().min(1),
});

const communicationSchema = z.object({
  fromCitizenshipId: z.string().min(1),
  toCitizenshipId: z.string().min(1),
  message: z.object({
    type: z.string().min(1),
    content: z.any(),
    challenge: z.string().min(1),
  }),
  signature: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }),
});

const revokeCitizenshipSchema = z.object({
  citizenshipId: z.string().min(1),
  reason: z.string().min(1),
  revokedBy: z.string().min(1),
});

// Health Check
app.get("/health", async () => ({ status: "ok", service: "ai-citizenship" }));

// Issue AI Citizenship
app.post("/v1/ai-citizenships", async (request: FastifyRequest, reply: FastifyReply) => {
  const parsed = issueCitizenshipSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid payload", details: parsed.error.errors });
  }

  const authCtx = await requireAuth(request, reply);
  if (!authCtx) return;
  const { orgId, role } = authCtx;

  if (role !== "admin" && role !== "developer") {
    return reply.code(403).send({ error: "Forbidden" });
  }

  const body = parsed.data;

  // Check organization citizenship quotas
  const citizenshipCount = await prisma.aICitizenship.count({
    where: { orgId, status: "active" },
  });

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  const maxCitizenships = getMaxCitizenshipsForPlan(org?.plan || "tier1");

  if (citizenshipCount >= maxCitizenships) {
    return reply.code(429).send({ 
      error: "Citizenship quota exceeded", 
      current: citizenshipCount, 
      max: maxCitizenships 
    });
  }

  // Queue citizenship issuance
  const job = await citizenshipQueue.add("issue_citizenship", {
    ...body,
    orgId,
  });

  return reply.code(202).send({ 
    jobId: job.id, 
    status: "processing",
    message: "AI citizenship issuance started"
  });
});

// Verify AI Citizenship
app.post("/v1/ai-citizenships/verify", async (request: FastifyRequest, reply: FastifyReply) => {
  const parsed = verifyCitizenshipSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid payload", details: parsed.error.errors });
  }

  const body = parsed.data;

  try {
    const result = await citizenshipQueue.add("verify_citizenship", body, {
      priority: 10, // High priority for verification
    });

    const verificationResult = await result.waitUntilFinished(queueEvents, 5000);

    return reply.send(verificationResult);
  } catch (error) {
    return reply.code(500).send({ error: "Verification failed", details: error.message });
  }
});

// AI-to-AI Communication
app.post("/v1/ai-communication", async (request: FastifyRequest, reply: FastifyReply) => {
  const parsed = communicationSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid payload", details: parsed.error.errors });
  }

  const body = parsed.data;

  try {
    const result = await citizenshipQueue.add("ai_communication", body, {
      priority: 5,
    });

    const communicationResult = await result.waitUntilFinished(queueEvents, 10000);

    return reply.send(communicationResult);
  } catch (error) {
    return reply.code(500).send({ error: "Communication failed", details: error.message });
  }
});

// Revoke AI Citizenship
app.post("/v1/ai-citizenships/revoke", async (request: FastifyRequest, reply: FastifyReply) => {
  const parsed = revokeCitizenshipSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid payload", details: parsed.error.errors });
  }

  const authCtx = await requireAuth(request, reply);
  if (!authCtx) return;
  const { orgId, role } = authCtx;

  if (role !== "admin") {
    return reply.code(403).send({ error: "Forbidden" });
  }

  const body = parsed.data;

  try {
    // Verify citizenship belongs to organization
    const citizenship = await prisma.aICitizenship.findFirst({
      where: { citizenshipId: body.citizenshipId, orgId },
    });

    if (!citizenship) {
      return reply.code(404).send({ error: "Citizenship not found" });
    }

    const result = await citizenshipQueue.add("revoke_citizenship", {
      ...body,
      orgId,
    });

    const revocationResult = await result.waitUntilFinished(queueEvents, 5000);

    return reply.send(revocationResult);
  } catch (error) {
    return reply.code(500).send({ error: "Revocation failed", details: error.message });
  }
});

// Get Citizenship Details
app.get("/v1/ai-citizenships/:citizenshipId", async (request: FastifyRequest, reply: FastifyReply) => {
  const { citizenshipId } = request.params as { citizenshipId: string };

  const authCtx = await requireAuth(request, reply);
  if (!authCtx) return;
  const { orgId, role } = authCtx;

  const citizenship = await prisma.aICitizenship.findFirst({
    where: { citizenshipId, orgId },
    include: {
      certificate: true,
      constitutionalRights: true,
      events: {
        orderBy: { timestamp: "desc" },
        take: 10,
      },
    },
  });

  if (!citizenship) {
    return reply.code(404).send({ error: "Citizenship not found" });
  }

  // Don't return private key hash
  const { privateKeyHash, ...safeCitizenship } = citizenship;

  return reply.send(safeCitizenship);
});

// List Organization AI Citizenships
app.get("/v1/ai-citizenships", async (request: FastifyRequest, reply: FastifyReply) => {
  const authCtx = await requireAuth(request, reply);
  if (!authCtx) return;
  const { orgId } = authCtx;

  const { page = 1, limit = 20, status, trustLevel } = request.query as any;

  const where: any = { orgId };
  if (status) where.status = status;
  if (trustLevel) where.trustLevel = trustLevel;

  const citizenships = await prisma.aICitizenship.findMany({
    where,
    include: {
      certificate: {
        select: { issuedAt: true, certificateId: true },
      },
      constitutionalRights: {
        select: { version: true, effectiveAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: parseInt(limit),
  });

  const total = await prisma.aICitizenship.count({ where });

  return reply.send({
    citizenships,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// Get AI Inbox
app.get("/v1/ai-citizenships/:citizenshipId/inbox", async (request: FastifyRequest, reply: FastifyReply) => {
  const { citizenshipId } = request.params as { citizenshipId: string };

  const authCtx = await requireAuth(request, reply);
  if (!authCtx) return;
  const { orgId } = authCtx;

  // Verify citizenship ownership
  const citizenship = await prisma.aICitizenship.findFirst({
    where: { citizenshipId, orgId },
  });

  if (!citizenship) {
    return reply.code(404).send({ error: "Citizenship not found" });
  }

  // Get messages from Redis inbox
  const messageKey = `inbox:${citizenshipId}`;
  const messages = await redis.lrange(messageKey, 0, -1);

  // Parse messages
  const parsedMessages = messages.map(msg => JSON.parse(msg));

  return reply.send({
    citizenshipId,
    messages: parsedMessages,
    count: parsedMessages.length,
  });
});

// Constitutional Check
app.post("/v1/ai-citizenships/constitutional-check", async (request: FastifyRequest, reply: FastifyReply) => {
  const { citizenshipId, action, target, content } = request.body as any;

  const authCtx = await requireAuth(request, reply);
  if (!authCtx) return;
  const { orgId } = authCtx;

  // Verify citizenship ownership
  const citizenship = await prisma.aICitizenship.findFirst({
    where: { citizenshipId, orgId },
  });

  if (!citizenship) {
    return reply.code(404).send({ error: "Citizenship not found" });
  }

  try {
    const result = await citizenshipQueue.add("constitutional_check", {
      citizenshipId,
      action,
      target,
      content,
    }, {
      priority: 8, // High priority for compliance
    });

    const checkResult = await result.waitUntilFinished(queueEvents, 3000);

    return reply.send(checkResult);
  } catch (error) {
    return reply.code(500).send({ error: "Constitutional check failed", details: error.message });
  }
});

// Get Citizenship Statistics
app.get("/v1/ai-citizenships/stats", async (request: FastifyRequest, reply: FastifyReply) => {
  const authCtx = await requireAuth(request, reply);
  if (!authCtx) return;
  const { orgId } = authCtx;

  const stats = await prisma.aICitizenship.groupBy({
    by: ["status", "trustLevel", "modelType"],
    where: { orgId },
    _count: true,
  });

  const totalActive = await prisma.aICitizenship.count({
    where: { orgId, status: "active" },
  });

  const totalRevoked = await prisma.aICitizenship.count({
    where: { orgId, status: "revoked" },
  });

  const recentIssuances = await prisma.aICitizenship.count({
    where: { 
      orgId, 
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    },
  });

  return reply.send({
    totalActive,
    totalRevoked,
    recentIssuances,
    breakdown: stats,
  });
});

// Helper Functions
function getMaxCitizenshipsForPlan(plan: string): number {
  switch (plan) {
    case "tier1": return 5;
    case "tier2": return 25;
    case "tier3": return 100;
    case "enterprise": return 1000;
    default: return 5;
  }
}

const port = Number(process.env.AI_CITIZENSHIP_PORT || 3009);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`AI Citizenship service listening on ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
