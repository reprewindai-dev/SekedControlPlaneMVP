import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const navigatorWorker = new Worker("celestial-navigation", async (job) => {
  const { runId, orgId, goalData, currentTrajectory } = job.data;
  
  // North Star Lock - Core mission anchor
  const northStar = await getNorthStar(orgId);
  const alignmentScore = calculateAlignment(currentTrajectory, northStar);
  
  // Waypoint Chain - Convert distant goals into achievable steps
  const waypoints = generateWaypoints(goalData, currentTrajectory);
  
  // Drift Detection - Monitor deviation from intended trajectory
  const driftAnalysis = detectDrift(currentTrajectory, waypoints);
  
  // Trajectory Projection - Model future states
  const projectedStates = projectTrajectory(currentTrajectory, waypoints, 5); // 5 steps ahead
  
  // Store navigation results
  await prisma.celestialNavigation.create({
    data: {
      runId,
      northStarId: northStar.id,
      alignmentScore,
      driftMagnitude: driftAnalysis.magnitude,
      driftDirection: driftAnalysis.direction,
      waypoints: waypoints,
      projectedStates: projectedStates,
      navigatedAt: new Date()
    }
  });
  
  // Enqueue next step if alignment is acceptable
  if (alignmentScore >= 0.7 && driftAnalysis.magnitude < 0.3) {
    await job.data.nextQueue.add("process", job.data);
  }
});

async function getNorthStar(orgId: string) {
  const northStar = await prisma.northStar.findFirst({
    where: { orgId, active: true }
  });
  
  if (!northStar) {
    throw new Error("No active North Star found for organization");
  }
  
  return northStar;
}

function calculateAlignment(trajectory: any, northStar: any) {
  // Calculate how well current trajectory aligns with North Star
  const trajectoryVector = trajectory.direction;
  const northStarVector = northStar.direction;
  
  const dotProduct = trajectoryVector.x * northStarVector.x + 
                     trajectoryVector.y * northStarVector.y + 
                     trajectoryVector.z * northStarVector.z;
  
  const magnitude = Math.sqrt(trajectoryVector.x ** 2 + trajectoryVector.y ** 2 + trajectoryVector.z ** 2) *
                    Math.sqrt(northStarVector.x ** 2 + northStarVector.y ** 2 + northStarVector.z ** 2);
  
  return dotProduct / magnitude; // Cosine similarity
}

function generateWaypoints(goalData: any, currentTrajectory: any) {
  const waypoints = [];
  const totalSteps = 10;
  
  for (let i = 1; i <= totalSteps; i++) {
    waypoints.push({
      step: i,
      position: {
        x: currentTrajectory.position.x + (goalData.target.x - currentTrajectory.position.x) * (i / totalSteps),
        y: currentTrajectory.position.y + (goalData.target.y - currentTrajectory.position.y) * (i / totalSteps),
        z: currentTrajectory.position.z + (goalData.target.z - currentTrajectory.position.z) * (i / totalSteps)
      },
      estimatedTime: currentTrajectory.timestamp + (goalData.targetTime - currentTrajectory.timestamp) * (i / totalSteps),
      requirements: calculateStepRequirements(i, totalSteps, goalData)
    });
  }
  
  return waypoints;
}

function detectDrift(currentTrajectory: any, waypoints: any[]) {
  const expectedPosition = waypoints[0].position; // Next expected position
  const actualPosition = currentTrajectory.position;
  
  const driftVector = {
    x: actualPosition.x - expectedPosition.x,
    y: actualPosition.y - expectedPosition.y,
    z: actualPosition.z - expectedPosition.z
  };
  
  const magnitude = Math.sqrt(driftVector.x ** 2 + driftVector.y ** 2 + driftVector.z ** 2);
  
  return {
    magnitude,
    direction: driftVector,
    severity: magnitude > 1.0 ? "high" : magnitude > 0.5 ? "medium" : "low"
  };
}

function projectTrajectory(currentTrajectory: any, waypoints: any[], stepsAhead: number) {
  const projections = [];
  
  for (let i = 1; i <= stepsAhead; i++) {
    const waypointIndex = Math.min(i, waypoints.length - 1);
    const waypoint = waypoints[waypointIndex];
    
    projections.push({
      step: i,
      position: waypoint.position,
      estimatedTime: waypoint.estimatedTime,
      confidence: 1.0 - (i * 0.1), // Decreasing confidence over time
      risks: assessTrajectoryRisks(waypoint, i)
    });
  }
  
  return projections;
}

function calculateStepRequirements(step: number, totalSteps: number, goalData: any) {
  const progress = step / totalSteps;
  return {
    resources: Math.floor(goalData.totalResources * progress),
    time: Math.floor(goalData.totalTime * progress),
    quality: goalData.minQuality + (goalData.targetQuality - goalData.minQuality) * progress
  };
}

function assessTrajectoryRisks(waypoint: any, stepIndex: number) {
  const risks = [];
  
  if (stepIndex > 5) {
    risks.push({
      type: "temporal_drift",
      probability: 0.1 * stepIndex,
      impact: "medium"
    });
  }
  
  if (waypoint.requirements.resources > 1000) {
    risks.push({
      type: "resource_depletion",
      probability: 0.15,
      impact: "high"
    });
  }
  
  return risks;
}

navigatorWorker.on("completed", (job) => {
  console.log(`Celestial navigation completed for run ${job.data.runId}`);
});

navigatorWorker.on("failed", (job, err) => {
  console.error(`Celestial navigation failed for run ${job.data.runId}:`, err);
});
