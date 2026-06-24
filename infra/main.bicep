targetScope = 'resourceGroup'

@description('Resource name prefix')
param workloadName string = 'sre-agent-ode-demo'

@description('Environment name')
param environmentName string = 'dev'

@description('Azure region')
param location string = resourceGroup().location

@description('Customer name')
param customerName string = 'Contoso Retail'

@description('Hosting mode')
@allowed([
  'aks'
  'appservice'
  'containerapps'
])
param hostingMode string = 'aks'

@description('AKS node count')
param aksNodeCount int = 2

@description('AKS VM size')
param aksVmSize string = 'Standard_D2s_v3'

@description('AKS cluster name')
param aksClusterName string = 'aks-contoso-sreagent-demo'

@description('Enable Container Insights')
param enableContainerInsights bool = true

@secure()
param sqlAdministratorPassword string = newGuid()

var resourceToken = toLower(uniqueString(resourceGroup().id, environmentName))
var tags = {
  workload: workloadName
  customer: customerName
  environment: environmentName
  purpose: 'sre-agent-ode-demo'
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
}

module cosmos 'modules/cosmos-nosql-sqlapi.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
  }
}

module azureSql 'modules/azure-sql.bicep' = {
  name: 'azureSql'
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    sqlAdministratorPassword: sqlAdministratorPassword
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
}

module aks 'modules/aks.bicep' = if (hostingMode == 'aks') {
  name: 'aks'
  params: {
    workloadName: workloadName
    location: location
    tags: tags
    resourceToken: resourceToken
    aksClusterName: aksClusterName
    nodeCount: aksNodeCount
    vmSize: aksVmSize
    enableContainerInsights: enableContainerInsights
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
  }
}

module acr 'modules/acr.bicep' = if (hostingMode == 'aks') {
  name: 'acr'
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
}

module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    location: location
    tags: tags
    appInsightsId: monitoring.outputs.appInsightsId
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
  }
}

output cosmosEndpoint string = cosmos.outputs.cosmosEndpoint
output cosmosAccountName string = cosmos.outputs.cosmosAccountName
output sqlServerFqdn string = azureSql.outputs.sqlServerFqdn
output logAnalyticsWorkspaceId string = monitoring.outputs.logAnalyticsWorkspaceId
output aksClusterName string = hostingMode == 'aks' ? aks!.outputs.clusterName : ''
output acrLoginServer string = hostingMode == 'aks' ? acr!.outputs.acrLoginServer : ''
output appUrl string = ''
