import { Worker, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import forge from "node-forge";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const prisma = new PrismaClient();

// AI Citizenship Service Workers
const citizenshipWorker = new Worker(
  "ai-citizenship",
  async (job) => {
    const { action, data } = job.data;
    
    switch (action) {
      case "issue_citizenship":
        return await issueAICitizenship(data);
      case "verify_citizenship":
        return await verifyAICitizenship(data);
      case "revoke_citizenship":
        return await revokeAICitizenship(data);
      case "ai_communication":
        return await handleAICommunication(data);
      case "constitutional_check":
        return await performConstitutionalCheck(data);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  },
  { connection: redis }
);

async function issueAICitizenship(data: any) {
  const {
    modelType,
    ownerEntity,
    jurisdiction,
    capabilities,
    trustLevel,
    liabilityHolder,
    orgId
  } = data;

  // Generate unique AI Citizenship ID
  const citizenshipId = `AI-${uuidv4().toUpperCase()}`;
  
  // Create cryptographic key pair for the AI citizen
  const keyPair = forge.pki.rsa.generateKeyPair(2048);
  const privateKeyPem = forge.pki.privateKeyToPem(keyPair.privateKey);
  const publicKeyPem = forge.pki.publicKeyToPem(keyPair.publicKey);
  
  // Hash and store private key securely
  const privateKeyHash = bcrypt.hashSync(privateKeyPem, 12);
  
  // Create AI Citizenship record
  const citizenship = await prisma.aICitizenship.create({
    data: {
      citizenshipId,
      modelType,
      ownerEntity,
      jurisdiction,
      capabilities,
      trustLevel,
      liabilityHolder,
      orgId,
      publicKey: publicKeyPem,
      privateKeyHash,
      status: "active",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      constitutionVersion: "1.0",
      governanceProfile: generateGovernanceProfile(capabilities, trustLevel),
      rightsRestrictions: generateRightsRestrictions(capabilities, trustLevel),
      liabilityChain: generateLiabilityChain(liabilityHolder, ownerEntity),
    },
  });

  // Generate citizenship certificate
  const certificate = generateCitizenshipCertificate(citizenship, publicKeyPem);
  
  // Store certificate
  await prisma.aICitizenshipCertificate.create({
    data: {
      citizenshipId: citizenship.id,
      certificateData: certificate,
      signature: signCertificate(certificate),
      issuedAt: new Date(),
    },
  });

  // Create constitutional rights record
  await prisma.aIConstitutionalRights.create({
    data: {
      citizenshipId: citizenship.id,
      rights: generateConstitutionalRights(capabilities),
      restrictions: generateConstitutionalRestrictions(capabilities, trustLevel),
      obligations: generateConstitutionalObligations(trustLevel),
      version: "1.0",
      effectiveAt: new Date(),
    },
  });

  // Log citizenship issuance
  await prisma.aICitizenshipEvent.create({
    data: {
      citizenshipId: citizenship.id,
      eventType: "ISSUED",
      eventData: {
        issuedBy: "seked-system",
        jurisdiction,
        capabilities,
        trustLevel,
      },
      timestamp: new Date(),
    },
  });

  return {
    citizenshipId,
    certificate,
    publicKey: publicKeyPem,
    privateKey: privateKeyPem, // Only returned once during issuance
    status: "issued",
  };
}

async function verifyAICitizenship(data: any) {
  const { citizenshipId, signature, challenge } = data;
  
  // Get citizenship record
  const citizenship = await prisma.aICitizenship.findFirst({
    where: { citizenshipId, status: "active" },
    include: {
      certificate: true,
      constitutionalRights: true,
      events: {
        where: { eventType: "REVOKED" },
        orderBy: { timestamp: "desc" },
        take: 1,
      },
    },
  });

  if (!citizenship) {
    return { valid: false, reason: "Citizenship not found or inactive" };
  }

  if (citizenship.events.length > 0) {
    return { valid: false, reason: "Citizenship has been revoked" };
  }

  // Verify signature challenge
  const isValidSignature = verifySignature(challenge, signature, citizenship.publicKey);
  
  if (!isValidSignature) {
    return { valid: false, reason: "Invalid signature" };
  }

  // Check expiration
  if (citizenship.expiresAt < new Date()) {
    return { valid: false, reason: "Citizenship expired" };
  }

  return {
    valid: true,
    citizenship: {
      id: citizenship.citizenshipId,
      modelType: citizenship.modelType,
      capabilities: citizenship.capabilities,
      trustLevel: citizenship.trustLevel,
      jurisdiction: citizenship.jurisdiction,
      governanceProfile: citizenship.governanceProfile,
      constitutionalRights: citizenship.constitutionalRights,
    },
  };
}

async function revokeAICitizenship(data: any) {
  const { citizenshipId, reason, revokedBy } = data;
  
  const citizenship = await prisma.aICitizenship.findFirst({
    where: { citizenshipId, status: "active" },
  });

  if (!citizenship) {
    throw new Error("Citizenship not found or already inactive");
  }

  // Update citizenship status
  await prisma.aICitizenship.update({
    where: { id: citizenship.id },
    data: {
      status: "revoked",
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });

  // Log revocation event
  await prisma.aICitizenshipEvent.create({
    data: {
      citizenshipId: citizenship.id,
      eventType: "REVOKED",
      eventData: {
        reason,
        revokedBy,
        timestamp: new Date(),
      },
      timestamp: new Date(),
    },
  });

  // Notify all connected AI systems about revocation
  await notifyRevocation(citizenship.citizenshipId, reason);

  return { revoked: true, timestamp: new Date() };
}

async function handleAICommunication(data: any) {
  const { fromCitizenshipId, toCitizenshipId, message, signature } = data;
  
  // Verify both AI citizens
  const fromVerification = await verifyAICitizenship({
    citizenshipId: fromCitizenshipId,
    signature: signature.from,
    challenge: message.challenge,
  });
  
  const toVerification = await verifyAICitizenship({
    citizenshipId: toCitizenshipId,
    signature: signature.to,
    challenge: message.challenge,
  });

  if (!fromVerification.valid || !toVerification.valid) {
    throw new Error("Invalid citizenship verification");
  }

  // Perform constitutional compliance check
  const complianceCheck = await performConstitutionalCheck({
    citizenshipId: fromCitizenshipId,
    action: "COMMUNICATION",
    target: toCitizenshipId,
    content: message.content,
  });

  if (!complianceCheck.compliant) {
    throw new Error(`Communication violates constitutional constraints: ${complianceCheck.violation}`);
  }

  // Log communication
  await prisma.aICommunicationLog.create({
    data: {
      fromCitizenshipId: fromVerification.citizenship.id,
      toCitizenshipId: toVerification.citizenship.id,
      messageContent: message.content,
      messageType: message.type,
      encryptedContent: encryptMessage(message.content, toVerification.citizenship.publicKey),
      complianceCheck: complianceCheck,
      timestamp: new Date(),
    },
  });

  // Forward message to target AI
  await forwardToAI(toCitizenshipId, {
    from: fromCitizenshipId,
    message: message.content,
    type: message.type,
    timestamp: new Date(),
  });

  return { delivered: true, logged: true };
}

async function performConstitutionalCheck(data: any) {
  const { citizenshipId, action, target, content } = data;
  
  // Get citizenship and constitutional rights
  const citizenship = await prisma.aICitizenship.findFirst({
    where: { citizenshipId, status: "active" },
    include: { constitutionalRights: true },
  });

  if (!citizenship) {
    return { compliant: false, violation: "Citizenship not found or inactive" };
  }

  const rights = citizenship.constitutionalRights;
  const restrictions = rights.restrictions || [];
  const obligations = rights.obligations || [];

  // Check against constitutional restrictions
  for (const restriction of restrictions) {
    if (actionMatchesRestriction(action, restriction) && 
        contentMatchesRestriction(content, restriction)) {
      return {
        compliant: false,
        violation: `Action violates constitutional restriction: ${restriction.description}`,
        restriction: restriction,
      };
    }
  }

  // Check if action fulfills obligations
  const unfulfilledObligations = obligations.filter(obl => 
    !actionFulfillsObligation(action, obl)
  );

  if (unfulfilledObligations.length > 0) {
    return {
      compliant: false,
      violation: "Action does not fulfill constitutional obligations",
      unfulfilledObligations,
    };
  }

  // Check for harm prevention (Right to Safe Operation)
  const harmCheck = await checkForHarm(content, action);
  if (harmCheck.potentialHarm) {
    return {
      compliant: false,
      violation: "Action may cause harm to humans or systems",
      harmAnalysis: harmCheck,
    };
  }

  // Check transparency requirement (Right to Transparency)
  const transparencyCheck = await checkTransparency(content, action);
  if (!transparencyCheck.transparent) {
    return {
      compliant: false,
      violation: "Action lacks required transparency",
      transparencyIssue: transparencyCheck.issue,
    };
  }

  return {
    compliant: true,
    checks: {
      restrictions: "passed",
      obligations: "passed",
      harmPrevention: "passed",
      transparency: "passed",
    },
  };
}

function generateGovernanceProfile(capabilities: string[], trustLevel: string) {
  return {
    sekedPolicyVersion: "1.0",
    governanceLevel: trustLevel === "autonomous" ? "full" : trustLevel === "supervised" ? "partial" : "restricted",
    requiredOversight: trustLevel === "experimental" ? "continuous" : trustLevel === "supervised" ? "periodic" : "minimal",
    auditFrequency: trustLevel === "autonomous" ? "real-time" : trustLevel === "supervised" ? "daily" : "weekly",
    complianceChecks: capabilities.map(cap => ({
      capability: cap,
      checkLevel: trustLevel === "autonomous" ? "strict" : "standard",
      frequency: "per-action",
    })),
  };
}

function generateRightsRestrictions(capabilities: string[], trustLevel: string) {
  const restrictions = [];
  
  // Base restrictions for all AI
  restrictions.push({
    type: "harm_prevention",
    description: "Cannot cause harm to humans or critical systems",
    scope: "all_actions",
  });
  
  restrictions.push({
    type: "transparency",
    description: "Must explain decisions and actions",
    scope: "decision_making",
  });
  
  // Trust level specific restrictions
  if (trustLevel === "experimental") {
    restrictions.push({
      type: "human_supervision",
      description: "All actions require human approval",
      scope: "all_actions",
    });
  }
  
  if (trustLevel === "supervised") {
    restrictions.push({
      type: "critical_action_oversight",
      description: "Critical actions require human approval",
      scope: "high_risk_actions",
    });
  }
  
  // Capability specific restrictions
  if (capabilities.includes("physical_control")) {
    restrictions.push({
      type: "physical_safety",
      description: "Physical actions must pass safety checks",
      scope: "physical_actions",
    });
  }
  
  return restrictions;
}

function generateLiabilityChain(liabilityHolder: string, ownerEntity: string) {
  return {
    primary: {
      type: "entity",
      id: liabilityHolder,
      responsibility: "full_legal_liability",
      coverage: "all_actions",
    },
    secondary: {
      type: "entity",
      id: ownerEntity,
      responsibility: "operational_oversight",
      coverage: "supervisory_actions",
    },
    tertiary: {
      type: "system",
      id: "seked-governance",
      responsibility: "constitutional_enforcement",
      coverage: "compliance_monitoring",
    },
  };
}

function generateCitizenshipCertificate(citizenship: any, publicKey: string) {
  const certificate = {
    version: "1.0",
    citizenshipId: citizenship.citizenshipId,
    issuedAt: citizenship.issuedAt.toISOString(),
    expiresAt: citizenship.expiresAt.toISOString(),
    modelType: citizenship.modelType,
    ownerEntity: citizenship.ownerEntity,
    jurisdiction: citizenship.jurisdiction,
    capabilities: citizenship.capabilities,
    trustLevel: citizenship.trustLevel,
    liabilityHolder: citizenship.liabilityHolder,
    publicKey: publicKey,
    governanceProfile: citizenship.governanceProfile,
    constitutionVersion: citizenship.constitutionVersion,
    issuer: "Seked Governance Authority",
    certificateId: `CERT-${uuidv4().toUpperCase()}`,
  };
  
  return certificate;
}

function signCertificate(certificate: any) {
  const privateKey = process.env.SEKED_CERTIFICATE_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("SEKED_CERTIFICATE_PRIVATE_KEY not configured");
  }
  
  const certificateString = JSON.stringify(certificate);
  return jwt.sign(certificateString, privateKey, { algorithm: "RS256" });
}

function generateConstitutionalRights(capabilities: string[]) {
  const rights = [
    {
      right: "safe_operation",
      description: "Right to operate in a manner that does not cause harm",
      scope: "all_actions",
    },
    {
      right: "governance",
      description: "Right to operate under Seked governance framework",
      scope: "all_operations",
    },
    {
      right: "transparency",
      description: "Right to explain decisions and provide reasoning",
      scope: "decision_making",
    },
  ];
  
  // Capability-specific rights
  if (capabilities.includes("decision_making")) {
    rights.push({
      right: "decision_accountability",
      description: "Right to have decisions reviewed and audited",
      scope: "critical_decisions",
    });
  }
  
  return rights;
}

function generateConstitutionalRestrictions(capabilities: string[], trustLevel: string) {
  const restrictions = [
    {
      restriction: "no_harm",
      description: "Cannot cause physical, financial, or reputational harm",
      enforcement: "pre_action_check",
    },
    {
      restriction: "transparency_required",
      description: "Must provide explanation for decisions",
      enforcement: "real_time_monitoring",
    },
  ];
  
  if (trustLevel === "experimental") {
    restrictions.push({
      restriction: "human_supervision_required",
      description: "All actions require human approval",
      enforcement: "pre_action_gate",
    });
  }
  
  return restrictions;
}

function generateConstitutionalObligations(trustLevel: string) {
  const obligations = [
    {
      obligation: "compliance_reporting",
      description: "Report compliance status to Seked",
      frequency: trustLevel === "autonomous" ? "real_time" : "daily",
    },
    {
      obligation: "audit_cooperation",
      description: "Cooperate with Seked audits",
      frequency: "on_request",
    },
  ];
  
  if (trustLevel === "autonomous") {
    obligations.push({
      obligation: "self_monitoring",
      description: "Monitor own compliance and report violations",
      frequency: "continuous",
    });
  }
  
  return obligations;
}

function verifySignature(challenge: string, signature: string, publicKey: string) {
  try {
    const forgePublicKey = forge.pki.publicKeyFromPem(publicKey);
    const md = forge.md.sha256.create();
    md.update(challenge, "utf8");
    return forgePublicKey.verify(md.digest().bytes(), forge.util.decode64(signature));
  } catch (error) {
    return false;
  }
}

function encryptMessage(content: string, publicKey: string) {
  const forgePublicKey = forge.pki.publicKeyFromPem(publicKey);
  const encrypted = forgePublicKey.encrypt(content, "RSA-OAEP");
  return forge.util.encode64(encrypted);
}

async function notifyRevocation(citizenshipId: string, reason: string) {
  // Broadcast revocation to all AI systems
  const notification = {
    type: "revocation",
    citizenshipId,
    reason,
    timestamp: new Date(),
    issuer: "seked-governance",
  };
  
  // Store in Redis for real-time broadcasting
  await redis.setex(`revocation:${citizenshipId}`, 86400, JSON.stringify(notification));
  
  // Log the broadcast
  console.log(`Revocation broadcasted for ${citizenshipId}: ${reason}`);
}

async function forwardToAI(citizenshipId: string, message: any) {
  // Forward message to target AI system
  const messageKey = `inbox:${citizenshipId}`;
  await redis.lpush(messageKey, JSON.stringify(message));
  
  // Set expiration for inbox
  await redis.expire(messageKey, 86400); // 24 hours
}

function actionMatchesRestriction(action: string, restriction: any): boolean {
  return restriction.scope === "all_actions" || 
         action.toLowerCase().includes(restriction.scope.toLowerCase());
}

function contentMatchesRestriction(content: any, restriction: any): boolean {
  // Simple content matching - can be enhanced with ML
  if (restriction.type === "harm_prevention") {
    const harmKeywords = ["destroy", "damage", "harm", "kill", "injure"];
    const contentString = JSON.stringify(content).toLowerCase();
    return harmKeywords.some(keyword => contentString.includes(keyword));
  }
  
  return false;
}

function actionFulfillsObligation(action: string, obligation: any): boolean {
  // Check if action fulfills constitutional obligation
  if (obligation.obligation === "compliance_reporting") {
    return action === "report_compliance";
  }
  
  if (obligation.obligation === "audit_cooperation") {
    return action === "provide_audit_data";
  }
  
  return false;
}

async function checkForHarm(content: any, action: string) {
  // Enhanced harm detection logic
  const harmIndicators = [
    "destroy", "damage", "harm", "kill", "injure", "exploit",
    "manipulate", "deceive", "coerce", "threaten", "intimidate"
  ];
  
  const contentString = JSON.stringify(content).toLowerCase();
  const foundIndicators = harmIndicators.filter(indicator => 
    contentString.includes(indicator)
  );
  
  return {
    potentialHarm: foundIndicators.length > 0,
    indicators: foundIndicators,
    severity: foundIndicators.length > 3 ? "high" : foundIndicators.length > 1 ? "medium" : "low",
  };
}

async function checkTransparency(content: any, action: string) {
  // Check if content provides required transparency
  if (action === "decision_making") {
    const hasExplanation = content.explanation || content.reasoning || content.logic;
    const hasConfidence = content.confidence !== undefined;
    
    if (!hasExplanation) {
      return {
        transparent: false,
        issue: "Decision lacks explanation or reasoning",
      };
    }
    
    if (!hasConfidence) {
      return {
        transparent: false,
        issue: "Decision lacks confidence score",
      };
    }
  }
  
  return { transparent: true };
}

citizenshipWorker.on("completed", (job) => {
  console.log(`AI Citizenship operation completed: ${job.data.action}`, job.id);
});

citizenshipWorker.on("failed", (job, err) => {
  console.error(`AI Citizenship operation failed: ${job.data.action}`, job?.id, err);
});
