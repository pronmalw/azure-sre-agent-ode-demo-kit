param location string
param tags object
param resourceToken string

@description('Address space for the primary application VNet (hosts AKS).')
param vnetAddressPrefix string = '10.10.0.0/16'

@description('Address space for the AKS node subnet.')
param aksSubnetPrefix string = '10.10.1.0/24'

@description('Address space for the primary VNet GatewaySubnet (required exact name for VPN Gateway).')
param gatewaySubnetPrefix string = '10.10.255.0/27'

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: 'vnet-${resourceToken}'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: 'subnet-aks'
        properties: {
          addressPrefix: aksSubnetPrefix
        }
      }
      {
        // Name must be exactly 'GatewaySubnet' — Azure VPN Gateway requirement.
        name: 'GatewaySubnet'
        properties: {
          addressPrefix: gatewaySubnetPrefix
        }
      }
    ]
  }
}

output vnetId string = vnet.id
output vnetName string = vnet.name
output aksSubnetId string = vnet.properties.subnets[0].id
output gatewaySubnetId string = vnet.properties.subnets[1].id
output vnetAddressPrefix string = vnetAddressPrefix
