export interface TelemetrySnapshot {
  latencyP50Ms: number;
  latencyP99Ms: number;
  cosmos429Count: number;
  ruUsage: number;
  serverSideLatencyMs: number;
  hostCpuPercent: number;
  checkoutSuccessRate: number;
  recentDeploymentEvent: boolean;
  activeToggles: string[];
  sqlQueryLatencyMs: number;
  sqlErrorCount: number;
  timestamp: string;
}

export enum IncidentClassification {
  AZURE_SERVICE_SIDE = 'AZURE_SERVICE_SIDE',
  APPLICATION_OR_CLIENT_SIDE = 'APPLICATION_OR_CLIENT_SIDE',
  DATABASE_CONFIG_OR_DATA_MODEL = 'DATABASE_CONFIG_OR_DATA_MODEL',
  SQL_DATABASE_OR_SCHEMA = 'SQL_DATABASE_OR_SCHEMA',
  NETWORK_OR_CONNECTIVITY = 'NETWORK_OR_CONNECTIVITY',
  HOST_OR_RUNTIME = 'HOST_OR_RUNTIME',
  RECENT_CHANGE_OR_DEPLOYMENT = 'RECENT_CHANGE_OR_DEPLOYMENT',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
}

export enum ConfidenceLevel {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export interface SreAgentReport {
  incidentId: string;
  primaryClassification: IncidentClassification;
  secondaryClassifications: IncidentClassification[];
  confidence: ConfidenceLevel;
  customerImpact: string;
  primaryOwner: string;
  secondaryOwners: string[];
  evidence: string[];
  ruledOutCauses: string[];
  missingEvidence: string[];
  immediateSafeActions: string[];
  approvalRequiredActions: string[];
  doNotDoGuidance: string[];
  escalationRecommendation: string;
  temporaryMitigation: string;
  permanentFix: string;
  rollbackGuidance: string;
  verificationCriteria: string[];
  executiveSummary: string;
  engineeringRca: string;
  teamsUpdate: string;
  generatedAt: string;
}
