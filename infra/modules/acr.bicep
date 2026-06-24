param location string
param tags object
param resourceToken string

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acrcontoso${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
    publicNetworkAccess: 'Enabled'
  }
}

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
