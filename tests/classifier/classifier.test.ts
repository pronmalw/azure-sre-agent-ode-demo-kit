import fs from 'fs';
import path from 'path';
import { classifyIncident } from '../../src/classifier/src';

const scenariosDir = path.resolve(__dirname, '../../scenarios');
const readScenario = (fileName: string) => JSON.parse(fs.readFileSync(path.join(scenariosDir, fileName), 'utf-8'));
const scenarioFiles = fs.readdirSync(scenariosDir).filter((fileName) => fileName.endsWith('.json'));

describe('classifier scenarios', () => {
  it.each(scenarioFiles)('matches expected classification for %s', (fileName) => {
    const scenario = readScenario(fileName);
    const report = classifyIncident(scenario.telemetry);
    expect(report.primaryClassification).toBe(scenario.expectedClassification.primary);
    scenario.expectedClassification.secondaryIncludes.forEach((value: string) => {
      expect(report.secondaryClassifications).toContain(value);
    });
    expect(report.confidence).toBe(scenario.expectedClassification.confidence);
    expect(report.evidence.length).toBeGreaterThan(0);
    expect(report.immediateSafeActions.length).toBeGreaterThan(1);
    expect(report.approvalRequiredActions.length).toBeGreaterThan(0);
    expect(report.doNotDoGuidance.length).toBeGreaterThan(0);
    expect(report.verificationCriteria.length).toBeGreaterThan(0);
  });

  it('adds recent deployment as a secondary classification when appropriate', () => {
    const scenario = readScenario('hot-partition-429.json');
    scenario.telemetry.recentDeploymentEvent = true;
    scenario.telemetry.latencyP99Ms = 1800;
    const report = classifyIncident(scenario.telemetry);
    expect(report.secondaryClassifications).toContain('RECENT_CHANGE_OR_DEPLOYMENT');
  });

  it('rules out SQL when SQL metrics are healthy', () => {
    const scenario = readScenario('hot-partition-429.json');
    const report = classifyIncident(scenario.telemetry);
    expect(report.ruledOutCauses.some((item: string) => item.includes('Azure SQL Database issue ruled out'))).toBe(true);
  });

  it('captures host runtime as secondary when CPU is elevated but not primary', () => {
    const scenario = readScenario('contoso-sql-cosmos-mixed-incident.json');
    const report = classifyIncident(scenario.telemetry);
    expect(report.secondaryClassifications).toContain('HOST_OR_RUNTIME');
  });

  it('uses Azure service-side classification when no toggles are enabled and server-side latency is high', () => {
    const scenario = readScenario('azure-service-side-issue.json');
    const report = classifyIncident(scenario.telemetry);
    expect(report.primaryClassification).toBe('AZURE_SERVICE_SIDE');
    expect(report.confidence).toBe('MEDIUM');
  });

  it('uses insufficient evidence when signals stay below thresholds', () => {
    const scenario = readScenario('insufficient-evidence.json');
    const report = classifyIncident(scenario.telemetry);
    expect(report.primaryClassification).toBe('INSUFFICIENT_EVIDENCE');
    expect(report.confidence).toBe('LOW');
  });

  it('detects SQL database or schema issues from slow SQL telemetry', () => {
    const scenario = readScenario('sql-slow-query.json');
    const report = classifyIncident(scenario.telemetry);
    expect(report.primaryClassification).toBe('SQL_DATABASE_OR_SCHEMA');
  });

  it('detects host runtime issues when CPU burn is the only toggle', () => {
    const scenario = readScenario('high-cpu-host-saturation.json');
    const report = classifyIncident(scenario.telemetry);
    expect(report.primaryClassification).toBe('HOST_OR_RUNTIME');
  });

  it('detects DB model issues for indexing or query anti-patterns', () => {
    const indexingScenario = readScenario('missing-indexing-policy.json');
    const pointReadScenario = readScenario('point-read-misuse.json');
    expect(classifyIncident(indexingScenario.telemetry).primaryClassification).toBe('DATABASE_CONFIG_OR_DATA_MODEL');
    expect(classifyIncident(pointReadScenario.telemetry).primaryClassification).toBe('DATABASE_CONFIG_OR_DATA_MODEL');
  });
});
