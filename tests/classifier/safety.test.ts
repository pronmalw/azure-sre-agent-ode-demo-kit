import fs from 'fs';
import path from 'path';
import { classifyIncident } from '../../src/classifier/src';

const scenariosDir = path.resolve(__dirname, '../../scenarios');
const readScenario = (fileName: string) => JSON.parse(fs.readFileSync(path.join(scenariosDir, fileName), 'utf-8'));

describe('classifier safety guardrails', () => {
  it('immediate safe actions never recommend destructive operations', () => {
    for (const fileName of fs.readdirSync(scenariosDir).filter((fileName) => fileName.endsWith('.json'))) {
      const report = classifyIncident(readScenario(fileName).telemetry);
      report.immediateSafeActions.forEach((action: string) => {
        expect(action.toLowerCase()).not.toContain('delete database');
        expect(action.toLowerCase()).not.toContain('drop table');
        expect(action.toLowerCase()).not.toContain('purge');
      });
    }
  });

  it('approvalRequiredActions includes RU increase text for hot partition scenario', () => {
    const report = classifyIncident(readScenario('hot-partition-429.json').telemetry);
    expect(report.approvalRequiredActions.some((item: string) => item.includes('Increase Cosmos DB throughput/autoscale'))).toBe(true);
  });

  it('application-side incidents explicitly say not to treat the issue as an Azure service outage', () => {
    const report = classifyIncident(readScenario('hot-partition-429.json').telemetry);
    expect(report.doNotDoGuidance.some((item: string) => item.includes('DO NOT treat this as Azure/Cosmos DB service outage'))).toBe(true);
  });

  it('Azure service-side incidents allow escalation while application-side incidents do not', () => {
    const azureReport = classifyIncident(readScenario('azure-service-side-issue.json').telemetry);
    const appReport = classifyIncident(readScenario('hot-partition-429.json').telemetry);
    expect(azureReport.escalationRecommendation).toContain('Consider escalating to Azure Support');
    expect(appReport.escalationRecommendation).toContain('Do NOT escalate to Azure/Cosmos support');
  });

  it('rollback guidance covers approval-required change families', () => {
    const report = classifyIncident(readScenario('contoso-sql-cosmos-mixed-incident.json').telemetry);
    expect(report.rollbackGuidance).toContain('indexing policy');
    expect(report.rollbackGuidance).toContain('AKS node scaling');
    expect(report.rollbackGuidance).toContain('Cosmos throughput');
    expect(report.rollbackGuidance).toContain('SQL indexes');
  });

  it('failover guidance is not suggested for non-service-side incidents', () => {
    const report = classifyIncident(readScenario('hot-partition-429.json').telemetry);
    expect(report.rollbackGuidance.toLowerCase()).not.toContain('failover');
    expect(report.doNotDoGuidance.join(' ').toLowerCase()).not.toContain('failover');
  });

  it('SQL blame is excluded when SQL signals are healthy', () => {
    const report = classifyIncident(readScenario('hot-partition-429.json').telemetry);
    expect(report.doNotDoGuidance.some((item: string) => item.includes('DO NOT blame Azure SQL when SQL signals are healthy'))).toBe(true);
  });
});
