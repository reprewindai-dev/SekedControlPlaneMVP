import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const shadowWorker = new Worker("shadow-tracking", async (job) => {
  const { runId, orgId, visibleSignal, context } = job.data;
  
  // Shadow Tracking - Infer unseen forces behind visible motion
  const shadowAnalysis = await analyzeShadow(visibleSignal, context, orgId);
  
  // Intent Vector - Direction + magnitude analysis
  const intentVector = calculateIntentVector(shadowAnalysis, visibleSignal);
  
  // Who benefits from this signal?
  const beneficiaries = identifyBeneficiaries(shadowAnalysis, context);
  
  // What changes next?
  const predictedChanges = predictNextChanges(shadowAnalysis, intentVector);
  
  // What is the likely trajectory?
  const trajectory = calculateTrajectory(shadowAnalysis, intentVector, predictedChanges);
  
  // Store shadow tracking results
  await prisma.shadowAnalysis.create({
    data: {
      runId,
      visibleSignal,
      shadowAnalysis,
      intentVector,
      beneficiaries,
      predictedChanges,
      trajectory,
      trackedAt: new Date()
    }
  });
  
  // Enqueue next step
  await job.data.nextQueue.add("process", job.data);
});

async function analyzeShadow(signal: any, context: any, orgId: string) {
  // Load historical shadow patterns
  const historicalShadows = await prisma.shadowPattern.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 500
  });
  
  // Identify hidden forces
  const hiddenForces = identifyHiddenForces(signal, context, historicalShadows);
  
  // Calculate shadow influence
  const shadowInfluence = calculateShadowInfluence(hiddenForces, signal);
  
  // Detect deception patterns
  const deceptionPatterns = detectDeception(signal, hiddenForces);
  
  return {
    hiddenForces,
    shadowInfluence,
    deceptionPatterns,
    confidence: calculateShadowConfidence(hiddenForces, historicalShadows)
  };
}

function identifyHiddenForces(signal: any, context: any, historicalShadows: any[]) {
  const forces = [];
  
  // Economic forces
  const economicForce = analyzeEconomicForce(signal, context);
  if (economicForce.strength > 0.3) {
    forces.push(economicForce);
  }
  
  // Political forces
  const politicalForce = analyzePoliticalForce(signal, context);
  if (politicalForce.strength > 0.3) {
    forces.push(politicalForce);
  }
  
  // Social forces
  const socialForce = analyzeSocialForce(signal, context);
  if (socialForce.strength > 0.3) {
    forces.push(socialForce);
  }
  
  // Technical forces
  const technicalForce = analyzeTechnicalForce(signal, context);
  if (technicalForce.strength > 0.3) {
    forces.push(technicalForce);
  }
  
  // Personal/individual forces
  const personalForce = analyzePersonalForce(signal, context);
  if (personalForce.strength > 0.3) {
    forces.push(personalForce);
  }
  
  return forces;
}

function analyzeEconomicForce(signal: any, context: any) {
  const economicIndicators = [
    "profit", "cost", "revenue", "market", "competition", "price", "value"
  ];
  
  const economicKeywords = signal.content?.toLowerCase().split(" ").filter((word: string) => 
    economicIndicators.some(indicator => word.includes(indicator))
  ) || [];
  
  const strength = Math.min(economicKeywords.length / 5, 1.0);
  
  return {
    type: "economic",
    strength,
    indicators: economicKeywords,
    direction: economicKeywords.includes("profit") || economicKeywords.includes("revenue") ? "positive" : "negative",
    actors: extractEconomicActors(signal, context)
  };
}

function analyzePoliticalForce(signal: any, context: any) {
  const politicalIndicators = [
    "power", "control", "authority", "government", "policy", "regulation", "law"
  ];
  
  const politicalKeywords = signal.content?.toLowerCase().split(" ").filter((word: string) => 
    politicalIndicators.some(indicator => word.includes(indicator))
  ) || [];
  
  const strength = Math.min(politicalKeywords.length / 4, 1.0);
  
  return {
    type: "political",
    strength,
    indicators: politicalKeywords,
    direction: politicalKeywords.includes("control") || politicalKeywords.includes("power") ? "centralizing" : "decentralizing",
    actors: extractPoliticalActors(signal, context)
  };
}

function analyzeSocialForce(signal: any, context: any) {
  const socialIndicators = [
    "people", "community", "society", "culture", "public", "social", "group"
  ];
  
  const socialKeywords = signal.content?.toLowerCase().split(" ").filter((word: string) => 
    socialIndicators.some(indicator => word.includes(indicator))
  ) || [];
  
  const strength = Math.min(socialKeywords.length / 4, 1.0);
  
  return {
    type: "social",
    strength,
    indicators: socialKeywords,
    direction: socialKeywords.includes("community") || socialKeywords.includes("people") ? "inclusive" : "exclusive",
    actors: extractSocialActors(signal, context)
  };
}

function analyzeTechnicalForce(signal: any, context: any) {
  const technicalIndicators = [
    "technology", "system", "algorithm", "data", "code", "platform", "infrastructure"
  ];
  
  const technicalKeywords = signal.content?.toLowerCase().split(" ").filter((word: string) => 
    technicalIndicators.some(indicator => word.includes(indicator))
  ) || [];
  
  const strength = Math.min(technicalKeywords.length / 3, 1.0);
  
  return {
    type: "technical",
    strength,
    indicators: technicalKeywords,
    direction: technicalKeywords.includes("system") || technicalKeywords.includes("platform") ? "integrating" : "fragmenting",
    actors: extractTechnicalActors(signal, context)
  };
}

function analyzePersonalForce(signal: any, context: any) {
  const personalIndicators = [
    "I", "me", "my", "personal", "individual", "self", "own"
  ];
  
  const personalKeywords = signal.content?.toLowerCase().split(" ").filter((word: string) => 
    personalIndicators.includes(word)
  ) || [];
  
  const strength = Math.min(personalKeywords.length / 3, 1.0);
  
  return {
    type: "personal",
    strength,
    indicators: personalKeywords,
    direction: personalKeywords.includes("my") || personalKeywords.includes("own") ? "self-interested" : "selfless",
    actors: extractPersonalActors(signal, context)
  };
}

function extractEconomicActors(signal: any, context: any) {
  const economicActors = [];
  
  if (context.participants) {
    economicActors.push(...context.participants.filter((p: any) => 
      p.role === "investor" || p.role === "customer" || p.role === "supplier"
    ));
  }
  
  return economicActors;
}

function extractPoliticalActors(signal: any, context: any) {
  const politicalActors = [];
  
  if (context.participants) {
    politicalActors.push(...context.participants.filter((p: any) => 
      p.role === "government" || p.role === "regulator" || p.role === "authority"
    ));
  }
  
  return politicalActors;
}

function extractSocialActors(signal: any, context: any) {
  const socialActors = [];
  
  if (context.participants) {
    socialActors.push(...context.participants.filter((p: any) => 
      p.role === "community" || p.role === "public" || p.role === "group"
    ));
  }
  
  return socialActors;
}

function extractTechnicalActors(signal: any, context: any) {
  const technicalActors = [];
  
  if (context.participants) {
    technicalActors.push(...context.participants.filter((p: any) => 
      p.role === "developer" || p.role === "engineer" || p.role === "system"
    ));
  }
  
  return technicalActors;
}

function extractPersonalActors(signal: any, context: any) {
  const personalActors = [];
  
  if (context.participants) {
    personalActors.push(...context.participants.filter((p: any) => 
      p.role === "individual" || p.role === "user" || p.role === "person"
    ));
  }
  
  return personalActors;
}

function calculateShadowInfluence(hiddenForces: any[], signal: any) {
  const totalStrength = hiddenForces.reduce((sum, force) => sum + force.strength, 0);
  const dominantForce = hiddenForces.reduce((max, force) => 
    force.strength > max.strength ? force : max, hiddenForces[0]
  );
  
  return {
    totalStrength,
    dominantForce: dominantForce.type,
    influenceDirection: dominantForce.direction,
    complexity: hiddenForces.length,
    stability: calculateStability(hiddenForces)
  };
}

function calculateStability(forces: any[]) {
  // Calculate how stable the force configuration is
  const opposingForces = forces.filter((force, i) => 
    forces.some((other, j) => i !== j && force.type === other.type && force.direction !== other.direction)
  );
  
  return 1 - (opposingForces.length / forces.length);
}

function detectDeception(signal: any, hiddenForces: any[]) {
  const deceptionIndicators = [];
  
  // Check for mismatch between stated intent and hidden forces
  const statedIntent = signal.statedIntent || "";
  const hiddenIntent = inferHiddenIntent(hiddenForces);
  
  if (statedIntent && hiddenIntent && statedIntent !== hiddenIntent) {
    deceptionIndicators.push({
      type: "intent_mismatch",
      stated: statedIntent,
      hidden: hiddenIntent,
      confidence: 0.8
    });
  }
  
  // Check for omission of key forces
  const mentionedForces = extractMentionedForces(signal);
  const significantHiddenForces = hiddenForces.filter(f => f.strength > 0.5);
  
  const omittedForces = significantHiddenForces.filter(force => 
    !mentionedForces.includes(force.type)
  );
  
  if (omittedForces.length > 0) {
    deceptionIndicators.push({
      type: "omission",
      omittedForces: omittedForces.map(f => f.type),
      confidence: 0.6
    });
  }
  
  return deceptionIndicators;
}

function inferHiddenIntent(hiddenForces: any[]) {
  const dominantForce = hiddenForces.reduce((max, force) => 
    force.strength > max.strength ? force : max, hiddenForces[0]
  );
  
  switch (dominantForce.type) {
    case "economic":
      return dominantForce.direction === "positive" ? "profit_maximization" : "cost_minimization";
    case "political":
      return dominantForce.direction === "centralizing" ? "power_consolidation" : "power_distribution";
    case "social":
      return dominantForce.direction === "inclusive" ? "community_building" : "exclusion";
    case "technical":
      return dominantForce.direction === "integrating" ? "system_unification" : "system_fragmentation";
    case "personal":
      return dominantForce.direction === "self-interested" : "self_benefit" : "self_sacrifice";
    default:
      return "unknown";
  }
}

function extractMentionedForces(signal: any) {
  const content = signal.content?.toLowerCase() || "";
  const forces = [];
  
  if (content.includes("profit") || content.includes("cost") || content.includes("money")) {
    forces.push("economic");
  }
  if (content.includes("power") || content.includes("control") || content.includes("government")) {
    forces.push("political");
  }
  if (content.includes("people") || content.includes("community") || content.includes("social")) {
    forces.push("social");
  }
  if (content.includes("technology") || content.includes("system") || content.includes("code")) {
    forces.push("technical");
  }
  if (content.includes("I") || content.includes("me") || content.includes("my")) {
    forces.push("personal");
  }
  
  return forces;
}

function calculateShadowConfidence(hiddenForces: any[], historicalShadows: any[]) {
  if (hiddenForces.length === 0) return 0.1;
  
  // Compare with historical patterns
  const matches = historicalShadows.filter(historical => {
    return hiddenForces.some(force => 
      historical.forceTypes.includes(force.type) && 
      Math.abs(force.strength - historical.strength) < 0.2
    );
  });
  
  return Math.min(matches.length / Math.max(historicalShadows.length, 1), 1.0);
}

function calculateIntentVector(shadowAnalysis: any, visibleSignal: any) {
  const direction = inferPrimaryDirection(shadowAnalysis, visibleSignal);
  const magnitude = calculateIntentMagnitude(shadowAnalysis, visibleSignal);
  const confidence = shadowAnalysis.confidence;
  
  return {
    direction,
    magnitude,
    confidence,
    components: {
      economic: shadowAnalysis.hiddenForces.find((f: any) => f.type === "economic")?.strength || 0,
      political: shadowAnalysis.hiddenForces.find((f: any) => f.type === "political")?.strength || 0,
      social: shadowAnalysis.hiddenForces.find((f: any) => f.type === "social")?.strength || 0,
      technical: shadowAnalysis.hiddenForces.find((f: any) => f.type === "technical")?.strength || 0,
      personal: shadowAnalysis.hiddenForces.find((f: any) => f.type === "personal")?.strength || 0
    }
  };
}

function inferPrimaryDirection(shadowAnalysis: any, visibleSignal: any) {
  const dominantForce = shadowAnalysis.hiddenForces.reduce((max: any, force: any) => 
    force.strength > max.strength ? force : max, shadowAnalysis.hiddenForces[0] || { strength: 0 }
  );
  
  if (dominantForce.strength < 0.3) {
    return "neutral";
  }
  
  return `${dominantForce.type}_${dominantForce.direction}`;
}

function calculateIntentMagnitude(shadowAnalysis: any, visibleSignal: any) {
  const totalStrength = shadowAnalysis.shadowInfluence.totalStrength;
  const deceptionScore = shadowAnalysis.deceptionPatterns.length > 0 ? 0.3 : 0;
  
  return Math.min(totalStrength + deceptionScore, 1.0);
}

function identifyBeneficiaries(shadowAnalysis: any, context: any) {
  const beneficiaries = [];
  
  for (const force of shadowAnalysis.hiddenForces) {
    if (force.actors && force.actors.length > 0) {
      beneficiaries.push(...force.actors.map((actor: any) => ({
        name: actor.name,
        type: actor.role,
        benefitType: force.type,
        benefitMagnitude: force.strength,
        confidence: 0.8
      })));
    }
  }
  
  // Remove duplicates and sort by benefit magnitude
  const uniqueBeneficiaries = beneficiaries.filter((beneficiary, index, self) => 
    index === self.findIndex(b => b.name === beneficiary.name)
  );
  
  return uniqueBeneficiaries.sort((a, b) => b.benefitMagnitude - a.benefitMagnitude);
}

function predictNextChanges(shadowAnalysis: any, intentVector: any) {
  const changes = [];
  
  // Predict changes based on dominant forces
  for (const force of shadowAnalysis.hiddenForces) {
    if (force.strength > 0.5) {
      changes.push(...predictForceChanges(force, intentVector));
    }
  }
  
  return changes;
}

function predictForceChanges(force: any, intentVector: any) {
  const changes = [];
  
  switch (force.type) {
    case "economic":
      if (force.direction === "positive") {
        changes.push({
          type: "resource_increase",
          probability: force.strength,
          timeframe: "short_term",
          description: "Increase in economic resources"
        });
      } else {
        changes.push({
          type: "resource_decrease",
          probability: force.strength,
          timeframe: "short_term",
          description: "Decrease in economic resources"
        });
      }
      break;
      
    case "political":
      if (force.direction === "centralizing") {
        changes.push({
          type: "power_consolidation",
          probability: force.strength,
          timeframe: "medium_term",
          description: "Consolidation of political power"
        });
      }
      break;
      
    case "social":
      if (force.direction === "inclusive") {
        changes.push({
          type: "community_growth",
          probability: force.strength,
          timeframe: "medium_term",
          description: "Growth of community participation"
        });
      }
      break;
      
    case "technical":
      if (force.direction === "integrating") {
        changes.push({
          type: "system_integration",
          probability: force.strength,
          timeframe: "short_term",
          description: "Integration of technical systems"
        });
      }
      break;
      
    case "personal":
      if (force.direction === "self-interested") {
        changes.push({
          type: "individual_gain",
          probability: force.strength,
          timeframe: "short_term",
          description: "Individual gains at expense of others"
        });
      }
      break;
  }
  
  return changes;
}

function calculateTrajectory(shadowAnalysis: any, intentVector: any, predictedChanges: any[]) {
  const trajectory = {
    current: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: intentVector.components.economic, y: intentVector.components.political, z: intentVector.components.social },
      acceleration: calculateAcceleration(shadowAnalysis)
    },
    predicted: [],
    confidence: intentVector.confidence,
    timeHorizon: "medium_term"
  };
  
  // Calculate predicted positions based on changes
  let currentPosition = { ...trajectory.current.position };
  let currentVelocity = { ...trajectory.current.velocity };
  
  for (let i = 1; i <= 5; i++) {
    // Apply changes to velocity
    for (const change of predictedChanges) {
      const delta = calculateChangeDelta(change, i);
      currentVelocity.x += delta.x;
      currentVelocity.y += delta.y;
      currentVelocity.z += delta.z;
    }
    
    // Update position
    currentPosition.x += currentVelocity.x;
    currentPosition.y += currentVelocity.y;
    currentPosition.z += currentVelocity.z;
    
    trajectory.predicted.push({
      step: i,
      position: { ...currentPosition },
      velocity: { ...currentVelocity },
      confidence: trajectory.confidence * (1 - i * 0.1),
      significantChanges: predictedChanges.filter(c => c.timeframe === "short_term" || (c.timeframe === "medium_term" && i <= 3))
    });
  }
  
  return trajectory;
}

function calculateAcceleration(shadowAnalysis: any) {
  const acceleration = { x: 0, y: 0, z: 0 };
  
  for (const force of shadowAnalysis.hiddenForces) {
    const delta = calculateForceAcceleration(force);
    acceleration.x += delta.x;
    acceleration.y += delta.y;
    acceleration.z += delta.z;
  }
  
  return acceleration;
}

function calculateForceAcceleration(force: any) {
  const delta = { x: 0, y: 0, z: 0 };
  
  switch (force.type) {
    case "economic":
      delta.x = force.strength * (force.direction === "positive" ? 1 : -1);
      break;
    case "political":
      delta.y = force.strength * (force.direction === "centralizing" ? 1 : -1);
      break;
    case "social":
      delta.z = force.strength * (force.direction === "inclusive" ? 1 : -1);
      break;
  }
  
  return delta;
}

function calculateChangeDelta(change: any, step: number) {
  const delta = { x: 0, y: 0, z: 0 };
  
  switch (change.type) {
    case "resource_increase":
      delta.x = change.probability * 0.1;
      break;
    case "resource_decrease":
      delta.x = -change.probability * 0.1;
      break;
    case "power_consolidation":
      delta.y = change.probability * 0.1;
      break;
    case "community_growth":
      delta.z = change.probability * 0.1;
      break;
    case "system_integration":
      delta.x = change.probability * 0.05;
      delta.y = change.probability * 0.05;
      break;
    case "individual_gain":
      delta.x = change.probability * 0.1;
      delta.y = -change.probability * 0.05;
      break;
  }
  
  // Apply decay over time
  const decay = Math.max(0, 1 - (step - 1) * 0.2);
  delta.x *= decay;
  delta.y *= decay;
  delta.z *= decay;
  
  return delta;
}

shadowWorker.on("completed", (job) => {
  console.log(`Shadow tracking completed for run ${job.data.runId}`);
});

shadowWorker.on("failed", (job, err) => {
  console.error(`Shadow tracking failed for run ${job.data.runId}:`, err);
});
