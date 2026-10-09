param location string
param tags object
param logAnalyticsWorkspaceId string

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-sre-demo'
  location: 'global'
  tags: tags
  properties: {
    enabled: true
    groupShortName: 'sredemo'
  }
}

// Alerts on the application's own contoso.latencyP99Ms custom metric rather than
// the standard requests/duration metric. The load generator drives the services
// in-process rather than over HTTP, so AppRequests is sparse and its average
// duration never approached the old 2000ms bound — the rule could not fire even
// while measured p99 reached 14,678ms. Healthy p99 is 60-150ms, so 400ms sits
// clear of normal variation.
resource latencyAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'contoso-p99-latency'
  location: location
  tags: tags
  properties: {
    description: 'Detect end-to-end p99 latency above 400ms (healthy baseline 60-150ms).'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    skipQueryValidation: true
    autoMitigate: true
    scopes: [
      logAnalyticsWorkspaceId
    ]
    criteria: {
      allOf: [
        {
          query: 'AppMetrics | where Name == "contoso.latencyP99Ms" | extend Value = Sum / todouble(ItemCount) | summarize AggregatedValue = max(Value) by bin(TimeGenerated, 5m) | where AggregatedValue > 400'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource cosmos429Alert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'contoso-cosmos-429'
  location: location
  tags: tags
  properties: {
    description: 'Detect high Cosmos DB 429 rates in the demo workload.'
    enabled: true
    severity: 2
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    skipQueryValidation: true
    autoMitigate: true
    scopes: [
      logAnalyticsWorkspaceId
    ]
    criteria: {
      allOf: [
        {
          query: 'AzureDiagnostics | where ResourceProvider == "MICROSOFT.DOCUMENTDB" | where statusCode_s == "429" | summarize Count = count() by bin(TimeGenerated, 5m) | where Count > 10'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

// --- Scenario alerts driven by the app's custom metrics (contoso.*) ---------
// The API publishes these every 30s from src/api/src/observability.ts. Each rule
// below turns one demo chaos scenario into a real Azure Monitor alert, which the
// Azure SRE Agent picks up as an incident via its AzMonitor incident connector.
var scenarioAlerts = [
  {
    name: 'contoso-host-cpu-saturation'
    description: 'Host/runtime CPU saturation on the Contoso Retail API (HOST_OR_RUNTIME scenario).'
    metric: 'contoso.hostCpuPercent'
    threshold: 70
    severity: 2
  }
  {
    name: 'contoso-sql-slow-query'
    description: 'Azure SQL query latency is elevated (SQL_DATABASE_OR_SCHEMA scenario).'
    metric: 'contoso.sqlQueryLatencyMs'
    threshold: 1000
    severity: 2
  }
  {
    name: 'contoso-vpn-tunnel-down'
    description: 'Site-to-site VPN tunnel is down (NETWORK_OR_CONNECTIVITY scenario).'
    metric: 'contoso.vpnTunnelDown'
    threshold: 0
    severity: 1
  }
  {
    name: 'contoso-vpn-packet-loss'
    description: 'Packet loss across the site-to-site VPN tunnel (NETWORK_OR_CONNECTIVITY scenario).'
    metric: 'contoso.networkPacketLossPercent'
    threshold: 20
    severity: 1
  }
  {
    name: 'contoso-cosmos-throttling'
    description: 'Cosmos DB request throttling (429s) observed by the application (APPLICATION_OR_CLIENT_SIDE scenario).'
    metric: 'contoso.cosmos429Count'
    threshold: 10
    severity: 2
  }
]

resource scenarioAlertRules 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for alert in scenarioAlerts: {
  name: alert.name
  location: location
  tags: tags
  properties: {
    description: alert.description
    enabled: true
    severity: alert.severity
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    skipQueryValidation: true
    autoMitigate: true
    scopes: [
      logAnalyticsWorkspaceId
    ]
    criteria: {
      allOf: [
        {
          // AppMetrics stores pre-aggregated buckets, so the mean value is Sum/ItemCount.
          query: 'AppMetrics | where Name == "${alert.metric}" | extend Value = Sum / todouble(ItemCount) | summarize AggregatedValue = max(Value) by bin(TimeGenerated, 5m)'
          timeAggregation: 'Maximum'
          metricMeasureColumn: 'AggregatedValue'
          operator: 'GreaterThan'
          threshold: alert.threshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}]

output actionGroupId string = actionGroup.id