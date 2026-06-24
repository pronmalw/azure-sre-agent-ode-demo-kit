param location string
param tags object
param resourceToken string
param logAnalyticsWorkspaceId string

var accountName = 'cosmos-${resourceToken}'

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-02-15-preview' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  tags: tags
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    enableAutomaticFailover: false
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-02-15-preview' = {
  parent: account
  name: 'contoso-retail'
  properties: {
    resource: {
      id: 'contoso-retail'
    }
  }
}

resource products 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: sqlDatabase
  name: 'products'
  properties: {
    resource: {
      id: 'products'
      partitionKey: {
        paths: ['/categoryId']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
      }
    }
  }
}

resource carts 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: sqlDatabase
  name: 'carts'
  properties: {
    resource: {
      id: 'carts'
      partitionKey: {
        paths: ['/userId']
        kind: 'Hash'
      }
    }
  }
}

resource userEvents 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: sqlDatabase
  name: 'UserEvents'
  properties: {
    resource: {
      id: 'UserEvents'
      defaultTtl: 86400
      partitionKey: {
        paths: ['/userId']
        kind: 'Hash'
      }
    }
  }
}

resource recommendations 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: sqlDatabase
  name: 'Recommendations'
  properties: {
    resource: {
      id: 'Recommendations'
      partitionKey: {
        paths: ['/userId']
        kind: 'Hash'
      }
    }
  }
}

resource reviews 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: sqlDatabase
  name: 'Reviews'
  properties: {
    resource: {
      id: 'Reviews'
      partitionKey: {
        paths: ['/productId']
        kind: 'Hash'
      }
    }
  }
}

resource investigations 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: sqlDatabase
  name: 'SreInvestigations'
  properties: {
    resource: {
      id: 'SreInvestigations'
      partitionKey: {
        paths: ['/incidentId']
        kind: 'Hash'
      }
    }
  }
}

resource productsNoIndex 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: sqlDatabase
  name: 'ProductsNoIndex'
  properties: {
    resource: {
      id: 'ProductsNoIndex'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'none'
        automatic: false
      }
    }
  }
}

resource demoTelemetry 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: sqlDatabase
  name: 'DemoTelemetry'
  properties: {
    resource: {
      id: 'DemoTelemetry'
      defaultTtl: 86400
      partitionKey: {
        paths: ['/partitionKey']
        kind: 'Hash'
      }
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: '${account.name}-diag'
  scope: account
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'Requests'
        enabled: true
      }
    ]
  }
}

output cosmosEndpoint string = account.properties.documentEndpoint
output cosmosAccountName string = account.name
