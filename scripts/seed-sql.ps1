param()
Set-Location "$PSScriptRoot\..\srcpi"
npm install
npx ts-node src/data/seed.ts sql
