import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const collapseWorker = new Worker("empire-collapse-prevention", async (job) => {
  const { runId, orgId, systemMetrics, decisions } = job.data;
  
  // Historical failure pattern detection
  const collapseIndicators = await detectCollapseIndicators(systemMetrics, decisions, orgId);
  
  // Apply specific failure pattern checks
  const overexpansionCheck = checkOverexpansion(systemMetrics, decisions);
  const corruptionCheck = checkInternalCorruption(decisions);
  const resourceCheck = checkResourceDepletion(systemMetrics);
  const identityCheck = checkLossOfIdentity(decisions, orgId);
  const adaptationCheck = checkFailureToAdapt(systemMetrics);
  const comboCheck = checkExternalInternalCombo(systemMetrics, decisions);
  const baseCheck = checkNeglectOfBase(systemMetrics);
  const hubrisCheck = checkHubrisArrogance(decisions);
  
  const allChecks = [
    overexpansionCheck,
    corruptionCheck,
    resourceCheck,
    identityCheck,
    adaptationCheck,
    comboCheck,
    baseCheck,
    hubrisCheck
  ];
  
  // Calculate overall collapse risk
  const collapseRisk = calculateCollapseRisk(allChecks);
  
  // Store collapse analysis
  await prisma.collapseAnalysis.create({
    data: {
      runId,
      indicators: collapseIndicators,
      checks: allChecks,
      overallRisk: collapseRisk,
      analyzedAt: new Date()
    }
  });
  
  // Block execution if collapse risk is too high
  if (collapseRisk > 0.8) {
    throw new Error(`Empire collapse risk too high: ${collapseRisk}`);
  }
  
  // Enqueue next step if acceptable risk
  if (collapseRisk < 0.6) {
    await job.data.nextQueue.add("process", job.data);
  }
});

async function detectCollapseIndicators(metrics: any, decisions: any, orgId: string) {
  const indicators = [];
  
  // Load historical collapse patterns
  const patterns = await prisma.collapsePattern.findMany({
    where: { orgId }
  });
  
  for (const pattern of patterns) {
    const match = matchPattern(metrics, decisions, pattern);
    if (match.score > 0.7) {
      indicators.push({
        patternId: pattern.id,
        patternName: pattern.name,
        matchScore: match.score,
        description: pattern.description,
        severity: pattern.severity,
        mitigations: pattern.mitigations
      });
    }
  }
  
  return indicators;
}

function matchPattern(metrics: any, decisions: any, pattern: any) {
  const patternData = JSON.parse(pattern.patternData);
  let score = 0;
  let checks = 0;
  
  // Check metric thresholds
  if (patternData.metrics) {
    for (const [metric, threshold] of Object.entries(patternData.metrics)) {
      checks++;
      if (metrics[metric] > threshold) {
        score += 1;
      }
    }
  }
  
  // Check decision patterns
  if (patternData.decisions) {
    for (const [decisionType, expectedPattern] of Object.entries(patternData.decisions)) {
      checks++;
      const actualPattern = decisions.filter((d: any) => d.type === decisionType);
      if (matchesDecisionPattern(actualPattern, expectedPattern)) {
        score += 1;
      }
    }
  }
  
  return {
    score: checks > 0 ? score / checks : 0,
    matchedChecks: score,
    totalChecks: checks
  };
}

function matchesDecisionPattern(actual: any[], expected: any) {
  // Simple pattern matching - can be enhanced
  return actual.length >= expected.minCount && 
         actual.length <= expected.maxCount;
}

function checkOverexpansion(metrics: any, decisions: any) {
  const expansionRate = metrics.growthRate || 0;
  const capacity = metrics.capacity || 1;
  const utilization = metrics.utilization || 0;
  
  const isOverexpanding = expansionRate > 0.5 && utilization > 0.9;
  const isBeyondCapacity = utilization > capacity;
  
  return {
    type: "overexpansion",
    risk: isOverexpanding || isBeyondCapacity ? (isBeyondCapacity ? 0.9 : 0.7) : 0.1,
    description: isBeyondCapacity ? 
      "System expanding beyond operational capacity" : 
      isOverexpanding ? 
      "Rapid expansion detected" : 
      "Normal growth patterns",
    mitigations: isBeyondCapacity ? [
      "Scale infrastructure",
      "Implement throttling",
      "Prioritize critical operations"
    ] : isOverexpanding ? [
      "Monitor growth metrics",
      "Plan capacity upgrades",
      "Implement gradual scaling"
    ] : []
  };
}

function checkInternalCorruption(decisions: any) {
  const recentDecisions = decisions.slice(-100); // Last 100 decisions
  const inconsistentDecisions = recentDecisions.filter((d: any) => d.inconsistency > 0.5);
  const selfBenefitingDecisions = recentDecisions.filter((d: any) => d.selfBenefit > 0.7);
  
  const corruptionRatio = (inconsistentDecisions.length + selfBenefitingDecisions.length) / recentDecisions.length;
  
  return {
    type: "internal_corruption",
    risk: corruptionRatio > 0.3 ? 0.8 : corruptionRatio > 0.1 ? 0.5 : 0.1,
    description: corruptionRatio > 0.3 ? 
      "High levels of inconsistent or self-serving decisions detected" : 
      corruptionRatio > 0.1 ? 
      "Some concerning decision patterns" : 
      "Decision patterns appear normal",
    mitigations: corruptionRatio > 0.3 ? [
      "Implement decision audit trails",
      "Add oversight committees",
      "Increase transparency requirements"
    ] : corruptionRatio > 0.1 ? [
      "Monitor decision patterns",
      "Implement peer review"
    ] : []
  };
}

function checkResourceDepletion(metrics: any) {
  const resourceUsage = metrics.resourceUsage || 0;
  const resourceAvailability = metrics.resourceAvailability || 1;
  const consumptionRate = metrics.consumptionRate || 0;
  
  const depletionRatio = resourceUsage / resourceAvailability;
  const isDepletingFast = consumptionRate > 0.8;
  
  return {
    type: "resource_depletion",
    risk: depletionRatio > 0.9 || isDepletingFast ? 0.9 : depletionRatio > 0.7 ? 0.6 : 0.2,
    description: depletionRatio > 0.9 ? 
      "Critical resource depletion" : 
      depletionRatio > 0.7 ? 
      "High resource usage" : 
      isDepletingFast ? 
      "Rapid resource consumption" : 
      "Resource levels acceptable",
    mitigations: depletionRatio > 0.9 ? [
      "Implement emergency conservation",
      "Scale down non-critical operations",
      "Seek additional resources"
    ] : depletionRatio > 0.7 ? [
      "Optimize resource usage",
      "Implement conservation measures"
    ] : isDepletingFast ? [
      "Monitor consumption patterns",
      "Implement usage caps"
    ] : []
  };
}

function checkLossOfIdentity(decisions: any, orgId: string) {
  const orgIdentity = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { mission: true, values: true, principles: true }
  });
  
  if (!orgIdentity) {
    return { type: "loss_of_identity", risk: 0.5, description: "Organization identity not defined" };
  }
  
  const missionAlignedDecisions = decisions.filter((d: any) => 
    d.missionAlignment > 0.7
  );
  
  const alignmentRatio = missionAlignedDecisions.length / decisions.length;
  
  return {
    type: "loss_of_identity",
    risk: alignmentRatio < 0.5 ? 0.8 : alignmentRatio < 0.7 ? 0.5 : 0.1,
    description: alignmentRatio < 0.5 ? 
      "Majority of decisions deviate from mission" : 
      alignmentRatio < 0.7 ? 
      "Some mission drift detected" : 
      "Strong mission alignment maintained",
    mitigations: alignmentRatio < 0.5 ? [
      "Reinforce mission statement",
      "Implement mission review checkpoints",
      "Leadership intervention required"
    ] : alignmentRatio < 0.7 ? [
      "Monitor mission alignment",
      "Provide mission training"
    ] : []
  };
}

function checkFailureToAdapt(metrics: any) {
  const environmentalChanges = metrics.environmentalChanges || [];
  const adaptationResponses = metrics.adaptationResponses || [];
  
  const adaptationRatio = adaptationResponses.length / Math.max(environmentalChanges.length, 1);
  const responseTime = metrics.averageResponseTime || 0;
  
  return {
    type: "failure_to_adapt",
    risk: adaptationRatio < 0.3 || responseTime > 1000 ? 0.8 : adaptationRatio < 0.6 ? 0.5 : 0.2,
    description: adaptationRatio < 0.3 ? 
      "Poor adaptation to environmental changes" : 
      responseTime > 1000 ? 
      "Slow response to changes" : 
      adaptationRatio < 0.6 ? 
      "Moderate adaptation issues" : 
      "Good adaptation capabilities",
    mitigations: adaptationRatio < 0.3 ? [
      "Implement adaptive monitoring",
      "Create rapid response teams",
      "Increase environmental scanning"
    ] : responseTime > 1000 ? [
      "Optimize response processes",
      "Implement automated responses"
    ] : adaptationRatio < 0.6 ? [
      "Improve adaptation strategies"
    ] : []
  };
}

function checkExternalInternalCombo(metrics: any, decisions: any) {
  const externalStress = metrics.externalStress || 0;
  const internalWeakness = metrics.internalWeakness || 0;
  
  const comboRisk = externalStress * internalWeakness;
  
  return {
    type: "external_internal_combo",
    risk: comboRisk > 0.7 ? 0.9 : comboRisk > 0.4 ? 0.6 : 0.2,
    description: comboRisk > 0.7 ? 
      "Dangerous combination of external stress and internal weakness" : 
      comboRisk > 0.4 ? 
      "Moderate risk combination" : 
      "Resilient to combined threats",
    mitigations: comboRisk > 0.7 ? [
      "Emergency strengthening of internal systems",
      "External threat mitigation",
      "Crisis management protocols"
    ] : comboRisk > 0.4 ? [
      "Monitor combined risk factors",
      "Prepare contingency plans"
    ] : []
  };
}

function checkNeglectOfBase(metrics: any) {
  const baseMetrics = metrics.baseMetrics || {};
  const advancedMetrics = metrics.advancedMetrics || {};
  
  const baseHealth = calculateBaseHealth(baseMetrics);
  const advancedFocus = calculateAdvancedFocus(advancedMetrics);
  
  const neglectRatio = advancedFocus / (baseHealth + 0.01);
  
  return {
    type: "neglect_of_base",
    risk: neglectRatio > 3 ? 0.8 : neglectRatio > 1.5 ? 0.5 : 0.2,
    description: neglectRatio > 3 ? 
      "Severe neglect of foundational systems" : 
      neglectRatio > 1.5 ? 
      "Moderate base neglect" : 
      "Good balance between base and advanced",
    mitigations: neglectRatio > 3 ? [
      "Immediate base system reinforcement",
      "Reallocate resources to foundations",
      "Pause advanced initiatives"
    ] : neglectRatio > 1.5 ? [
      "Increase base system investment",
      "Balance resource allocation"
    ] : []
  };
}

function checkHubrisArrogance(decisions: any) {
  const overconfidentDecisions = decisions.filter((d: any) => d.confidence > 0.9);
  const riskIgnoringDecisions = decisions.filter((d: any) => d.risksIgnored > 0);
  
  const hubrisRatio = (overconfidentDecisions.length + riskIgnoringDecisions.length) / decisions.length;
  
  return {
    type: "hubris_arrogance",
    risk: hubrisRatio > 0.4 ? 0.8 : hubrisRatio > 0.2 ? 0.5 : 0.2,
    description: hubrisRatio > 0.4 ? 
      "Dangerous overconfidence and risk ignorance" : 
      hubrisRatio > 0.2 ? 
      "Some concerning confidence patterns" : 
      "Appropriate confidence levels",
    mitigations: hubrisRatio > 0.4 ? [
      "Implement reality checks",
      "Mandatory risk assessments",
      "Humility training for decision makers"
    ] : hubrisRatio > 0.2 ? [
      "Monitor confidence levels",
      "Implement peer review"
    ] : []
  };
}

function calculateBaseHealth(baseMetrics: any) {
  const factors = ["stability", "reliability", "performance", "security"];
  return factors.reduce((sum, factor) => sum + (baseMetrics[factor] || 0), 0) / factors.length;
}

function calculateAdvancedFocus(advancedMetrics: any) {
  const factors = ["innovation", "expansion", "optimization", "growth"];
  return factors.reduce((sum, factor) => sum + (advancedMetrics[factor] || 0), 0) / factors.length;
}

function calculateCollapseRisk(checks: any[]) {
  const risks = checks.map(check => check.risk);
  const maxRisk = Math.max(...risks);
  const avgRisk = risks.reduce((sum, risk) => sum + risk, 0) / risks.length;
  const highRiskCount = risks.filter(risk => risk > 0.7).length;
  
  // Weight towards maximum risk but consider overall pattern
  return (maxRisk * 0.5) + (avgRisk * 0.3) + (highRiskCount / checks.length * 0.2);
}

collapseWorker.on("completed", (job) => {
  console.log(`Empire collapse analysis completed for run ${job.data.runId}`);
});

collapseWorker.on("failed", (job, err) => {
  console.error(`Empire collapse analysis failed for run ${job.data.runId}:`, err);
});
