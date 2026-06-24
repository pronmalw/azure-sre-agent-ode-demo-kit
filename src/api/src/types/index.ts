export interface Product {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName: string;
  imageUrl: string;
  sku: string;
  inStock: boolean;
  rating: number;
  reviewCount: number;
  attributes: Record<string, string | number | boolean | string[]>;
}

export interface ProductPricing {
  productId: string;
  currency: string;
  listPrice: number;
  salePrice: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface Cart {
  id: string;
  userId: string;
  items: CartItem[];
  updatedAt: string;
}

export interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface Customer {
  customerId: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface CustomerAddress {
  addressId: string;
  customerId: string;
  addressLine1: string;
  city: string;
  country: string;
  postalCode: string;
}

export interface Order {
  orderId: string;
  customerId: string;
  orderDate: string;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  totalAmount: number;
  paymentStatus: 'pending' | 'completed' | 'failed';
  items: OrderItem[];
}

export interface OrderItem {
  orderItemId: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Review {
  id: string;
  productId: string;
  userId: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
}

export interface DemoEvent {
  id: string;
  partitionKey: string;
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface ChaosState {
  hotPartition: boolean;
  metadataThrottling: boolean;
  multipleClients: boolean;
  highCpu: boolean;
  crossPartitionQuery: boolean;
  largeDocument: boolean;
  missingIndexing: boolean;
  pointReadMisuse: boolean;
  sqlSlowQuery: boolean;
  sqlConnectionPressure: boolean;
}

export const DEFAULT_CHAOS_STATE: ChaosState = {
  hotPartition: false,
  metadataThrottling: false,
  multipleClients: false,
  highCpu: false,
  crossPartitionQuery: false,
  largeDocument: false,
  missingIndexing: false,
  pointReadMisuse: false,
  sqlSlowQuery: false,
  sqlConnectionPressure: false,
};

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

export interface AppConfig {
  cosmosEndpoint: string;
  cosmosKey: string;
  cosmosDatabaseId: string;
  sqlServer: string;
  sqlDatabase: string;
  sqlUser: string;
  sqlPassword: string;
  appInsightsConnectionString: string;
  port: number;
  nodeEnv: string;
}
