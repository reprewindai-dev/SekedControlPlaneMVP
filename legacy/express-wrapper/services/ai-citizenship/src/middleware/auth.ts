import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

interface AuthContext {
  orgId: string;
  apiKeyId: string;
  role: string;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthContext | null> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid authorization header" });
    return null;
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback-secret", { algorithms: ["HS256"] }) as any;
    
    // Get API key from database
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: decoded.apiKeyId },
      include: { organization: true },
    });

    if (!apiKey || apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt < new Date())) {
      reply.code(401).send({ error: "Invalid or expired API key" });
      return null;
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      orgId: apiKey.organization.id,
      apiKeyId: apiKey.id,
      role: apiKey.role,
    };
  } catch (error) {
    reply.code(401).send({ error: "Invalid authentication token" });
    return null;
  }
}

export async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthContext | null> {
  const authCtx = await requireAuth(request, reply);
  
  if (!authCtx) return null;
  
  if (authCtx.role !== "admin") {
    reply.code(403).send({ error: "Admin access required" });
    return null;
  }
  
  return authCtx;
}
