param(
  [string]$BaseUrl = "http://localhost:3001/api",
  [int]$Iterations = 30
)
for ($index = 0; $index -lt $Iterations; $index++) {
  Invoke-RestMethod "$BaseUrl/products" | Out-Null
  Start-Sleep -Milliseconds 500
}
