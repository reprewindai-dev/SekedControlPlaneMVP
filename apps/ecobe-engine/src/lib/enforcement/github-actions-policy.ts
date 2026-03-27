import type { WaterDecisionAction, WaterDecisionMode } from '../water/types'

export interface GithubActionsEnforcementInput {
  decisionFrameId: string
  decision: WaterDecisionAction
  decisionMode: WaterDecisionMode
  selectedRegion: string
  preferredRegions: string[]
  criticality: 'critical' | 'standard' | 'batch'
  notBefore?: string | null
}

export interface GithubActionsEnforcementBundle {
  executable: boolean
  decision: WaterDecisionAction
  concurrency: {
    group: string
    cancelInProgress: boolean
  }
  maxParallel: number
  environment: string
  notBefore: string | null
  matrixAllowedRegions: string[]
}

export function buildGithubActionsEnforcementBundle(
  input: GithubActionsEnforcementInput
): GithubActionsEnforcementBundle {
  const executable = input.decisionMode !== 'scenario_planning'
  const base = {
    executable,
    decision: input.decision,
    concurrency: {
      group: `ecobe-${input.decisionFrameId}`,
      cancelInProgress: false,
    },
    maxParallel: 1,
    environment: executable ? 'ecobe-authorized' : 'ecobe-preview',
    notBefore: input.notBefore ?? null,
    matrixAllowedRegions: [input.selectedRegion],
  }

  if (input.decision === 'delay') {
    return {
      ...base,
      maxParallel: 0,
      environment: executable ? 'ecobe-deferred' : 'ecobe-preview-deferred',
    }
  }

  if (input.decision === 'throttle') {
    return {
      ...base,
      maxParallel: input.criticality === 'critical' ? 2 : 1,
      environment: executable ? 'ecobe-throttled' : 'ecobe-preview-throttled',
    }
  }

  if (input.decision === 'reroute') {
    return {
      ...base,
      matrixAllowedRegions: [input.selectedRegion],
      environment: executable ? 'ecobe-rerouted' : 'ecobe-preview-rerouted',
    }
  }

  if (input.decision === 'deny') {
    return {
      ...base,
      maxParallel: 0,
      environment: executable ? 'ecobe-blocked' : 'ecobe-preview-blocked',
      matrixAllowedRegions: [],
    }
  }

  return {
    ...base,
    matrixAllowedRegions: [input.selectedRegion, ...input.preferredRegions.filter((region) => region !== input.selectedRegion)].slice(0, 3),
  }
}
