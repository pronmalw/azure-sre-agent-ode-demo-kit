// Dedicated Cosmos DB account used only to generate REAL HTTP 429 throttling.
//
// The main application account (modules/cosmos-nosql-sqlapi.bicep) runs in
// EnableServerless mode, which scales RU automatically and therefore cannot be
// driven into sustained throttling. Producing genuine 429s requires a
// provisioned-throughput container pinned at the 400 RU/s minimum, which is
// what CosmosThrottleService writes against.

@description('Azure region for the throttle probe account.')
param location string = resourceGroup().location

@description('Resource tags applied to the account.')
param tags object = {}

@description('Unique suffix so the globally scoped account name does not collide.')
param resourceToken string

@description('Database that holds the hot-partition container.')
param databaseId string = 'throttle-demo'

@description('Container deliberately provisioned at the 400 RU/s minimum.')
param containerId string = 'HotPartition'

var accountName = toLower('cosmos-throttle-${resourceToken}')

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-02-15-preview' = {
  name: accountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    // Deliberately NOT EnableServerless: serverless auto-scales RU and would
    // absorb the load instead of returning 429.
    capabilities: []
    enableAutomaticFailover: false
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-02-15-preview' = {
  parent: account
  name: databaseId
  properties: {
    resource: {
      id: databaseId
    }
  }
}

resource hotPartition 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-02-15-preview' = {
  parent: database
  name: containerId
  properties: {
    resource: {
      id: containerId
      partitionKey: {
        paths: [
          // Must match the `pk` property written by CosmosThrottleService.
          '/pk'
        ]
        kind: 'Hash'
      }
      // Short TTL keeps the probe documents from accumulating cost.
      defaultTtl: 3600
    }
    options: {
      // The 400 RU/s floor is the whole point: it is small enough that the
      // probe can exhaust it and force Cosmos to return real 429s.
      throughput: 400
    }
  }
}

output accountName string = account.name
output endpoint string = account.properties.documentEndpoint
output databaseId string = databaseId
output containerId string = containerId
