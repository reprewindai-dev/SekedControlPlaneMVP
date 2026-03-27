import type { WaterDecisionAction, WaterPolicyProfile } from '../water/types'

export interface KubernetesEnforcementInput {
  decisionFrameId: string
  decision: WaterDecisionAction
  decisionMode?: 'runtime_authorization' | 'scenario_planning'
  reasonCode: string
  selectedRegion: string
  policyProfile: WaterPolicyProfile
  criticality: 'critical' | 'standard' | 'batch'
  generatedAt?: Date
  delayMinutes?: number
  throttleFactor?: number
  notBefore?: string | null
  waterAuthorityMode?: 'basin' | 'facility_overlay' | 'fallback'
  waterScenario?: 'current' | '2030' | '2050' | '2080'
  proofHash?: string | null
}

export interface GatekeeperPolicyBundle {
  constraintTemplateName: string
  constraintName: string
  requiredLabels: string[]
  parameters: {
    decisionFrameId: string
    selectedRegion: string
    notBefore: string | null
    minReplicaFactor: number
    maxReplicaFactor: number
    blocked: boolean
  }
  template: Record<string, unknown>
  constraint: Record<string, unknown>
}

export interface KubernetesEnforcementPlan {
  admission: {
    allow: boolean
    reason: string
  }
  labels: Record<string, string>
  annotations: Record<string, string>
  nodeSelector: Record<string, string>
  nodeAffinity: {
    requiredRegion: string
    preferredRegions: string[]
  }
  tolerations: Array<{
    key: string
    operator: 'Equal'
    value: string
    effect: 'NoSchedule'
  }>
  scaling: {
    mode: 'normal' | 'throttled' | 'deferred' | 'blocked'
    targetReplicaFactor: number
    maxReplicaFactor: number
  }
  execution: {
    mode: 'immediate' | 'deferred' | 'blocked'
    notBefore: string | null
  }
  gatekeeper: GatekeeperPolicyBundle
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function buildKubernetesEnforcementPlan(
  input: KubernetesEnforcementInput
): KubernetesEnforcementPlan {
  const generatedAt = input.generatedAt ?? new Date()
  const region = input.selectedRegion
  const safeRegionLabel = region.toLowerCase()
  const throttleFactor = clamp(input.throttleFactor ?? 0.5, 0.1, 1)
  const delayMinutes =
    input.delayMinutes ??
    (input.criticality === 'batch' ? 30 : input.criticality === 'critical' ? 5 : 15)

  const baseLabels: Record<string, string> = {
    'ecobe.io/decision-frame': input.decisionFrameId,
    'ecobe.io/region': safeRegionLabel,
    'ecobe.io/policy-profile': input.policyProfile,
    'ecobe.io/decision': input.decision,
    'ecobe.io/water-authority': input.waterAuthorityMode ?? 'basin',
    'ecobe.io/water-scenario': input.waterScenario ?? 'current',
  }

  const baseAnnotations: Record<string, string> = {
    'ecobe.io/reason-code': input.reasonCode,
    'ecobe.io/generated-at': generatedAt.toISOString(),
    'ecobe.io/enforcement': 'deterministic',
    'ecobe.io/decision-mode': input.decisionMode ?? 'runtime_authorization',
  }
  if (input.proofHash) {
    baseAnnotations['ecobe.io/proof-hash'] = input.proofHash
  }

  const baseTolerations: KubernetesEnforcementPlan['tolerations'] = [
    {
      key: 'ecobe.io/policy-profile',
      operator: 'Equal',
      value: input.policyProfile,
      effect: 'NoSchedule',
    },
  ]

  const plan: KubernetesEnforcementPlan = {
    admission: {
      allow: true,
      reason: input.reasonCode,
    },
    labels: baseLabels,
    annotations: baseAnnotations,
    nodeSelector: {
      'topology.kubernetes.io/region': safeRegionLabel,
      'ecobe.io/region': safeRegionLabel,
    },
    nodeAffinity: {
      requiredRegion: safeRegionLabel,
      preferredRegions: [safeRegionLabel],
    },
    tolerations: baseTolerations,
    scaling: {
      mode: 'normal',
      targetReplicaFactor: 1,
      maxReplicaFactor: 1,
    },
    execution: {
      mode: 'immediate',
      notBefore: null,
    },
    gatekeeper: {
      constraintTemplateName: 'ecobedecisionguard',
      constraintName: `ecobe-${input.decisionFrameId.toLowerCase()}`,
      requiredLabels: ['ecobe.io/decision-frame', 'ecobe.io/region', 'ecobe.io/decision'],
      parameters: {
        decisionFrameId: input.decisionFrameId,
        selectedRegion: safeRegionLabel,
        notBefore: input.notBefore ?? null,
        minReplicaFactor: 1,
        maxReplicaFactor: 1,
        blocked: false,
      },
      template: {},
      constraint: {},
    },
  }

  if (input.decision === 'delay') {
    const notBefore = input.notBefore ?? new Date(generatedAt.getTime() + delayMinutes * 60 * 1000).toISOString()
    plan.scaling.mode = 'deferred'
    plan.scaling.targetReplicaFactor = 0
    plan.scaling.maxReplicaFactor = 0
    plan.execution.mode = 'deferred'
    plan.execution.notBefore = notBefore
    plan.annotations['ecobe.io/not-before'] = notBefore
    plan.annotations['ecobe.io/delay-minutes'] = String(delayMinutes)
    plan.gatekeeper.parameters.notBefore = notBefore
    plan.gatekeeper.parameters.minReplicaFactor = 0
    plan.gatekeeper.parameters.maxReplicaFactor = 0
    finalizeGatekeeper(plan)
    return plan
  }

  if (input.decision === 'throttle') {
    const targetFactor =
      input.criticality === 'critical' ? clamp(throttleFactor, 0.4, 1) : clamp(throttleFactor, 0.1, 0.7)
    plan.scaling.mode = 'throttled'
    plan.scaling.targetReplicaFactor = Number(targetFactor.toFixed(3))
    plan.scaling.maxReplicaFactor = Number(Math.max(targetFactor, 0.5).toFixed(3))
    plan.annotations['ecobe.io/throttle-factor'] = String(plan.scaling.targetReplicaFactor)
    plan.gatekeeper.parameters.minReplicaFactor = Number(plan.scaling.targetReplicaFactor.toFixed(3))
    plan.gatekeeper.parameters.maxReplicaFactor = Number(plan.scaling.maxReplicaFactor.toFixed(3))
    finalizeGatekeeper(plan)
    return plan
  }

  if (input.decision === 'deny') {
    plan.admission.allow = false
    plan.scaling.mode = 'blocked'
    plan.scaling.targetReplicaFactor = 0
    plan.scaling.maxReplicaFactor = 0
    plan.execution.mode = 'blocked'
    plan.execution.notBefore = null
    plan.annotations['ecobe.io/blocked'] = 'true'
    plan.gatekeeper.parameters.minReplicaFactor = 0
    plan.gatekeeper.parameters.maxReplicaFactor = 0
    plan.gatekeeper.parameters.blocked = true
    finalizeGatekeeper(plan)
    return plan
  }

  if (input.decision === 'reroute') {
    plan.annotations['ecobe.io/reroute'] = 'true'
    finalizeGatekeeper(plan)
    return plan
  }

  finalizeGatekeeper(plan)
  return plan
}

function finalizeGatekeeper(plan: KubernetesEnforcementPlan) {
  const labelSelector = {
    matchLabels: {
      'ecobe.io/decision-frame': plan.labels['ecobe.io/decision-frame'],
    },
  }

  plan.gatekeeper.template = {
    apiVersion: 'templates.gatekeeper.sh/v1beta1',
    kind: 'ConstraintTemplate',
    metadata: {
      name: plan.gatekeeper.constraintTemplateName,
    },
    spec: {
      crd: {
        spec: {
          names: {
            kind: 'EcobeDecisionGuard',
          },
        },
      },
      targets: [
        {
          target: 'admission.k8s.gatekeeper.sh',
          rego: `
package ecobedecisionguard

violation[{"msg": msg}] {
  required := {"ecobe.io/decision-frame", "ecobe.io/region", "ecobe.io/decision"}
  provided := {key | input.review.object.metadata.labels[key]}
  missing := required - provided
  count(missing) > 0
  msg := sprintf("missing ecobe labels: %v", [missing])
}

violation[{"msg": msg}] {
  expected := input.parameters.selectedRegion
  actual := input.review.object.metadata.labels["ecobe.io/region"]
  expected != actual
  msg := sprintf("region %v violates ecobe authorization region %v", [actual, expected])
}

violation[{"msg": msg}] {
  input.parameters.blocked
  msg := "workload is blocked by ecobe authorization"
}
`,
        },
      ],
    },
  }

  plan.gatekeeper.constraint = {
    apiVersion: 'constraints.gatekeeper.sh/v1beta1',
    kind: 'EcobeDecisionGuard',
    metadata: {
      name: plan.gatekeeper.constraintName,
    },
    spec: {
      match: {
        kinds: [
          {
            apiGroups: [''],
            kinds: ['Pod'],
          },
        ],
        labelSelector,
      },
      parameters: plan.gatekeeper.parameters,
    },
  }
}
