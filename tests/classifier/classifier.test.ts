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

  // The stored scenarios all sit below the 429 threshold that the client-side
  // branch keys on, so on their own they cannot show what happens once a
  // data-model fault is left running under sustained load. It throttles heavily
  // then, and the incident used to be reported as a generic client-side fault —
  // sending it to the application team rather than the data platform team.
  it.each(['cross-partition-query.json', 'missing-indexing-policy.json', 'point-read-misuse.json'])(
    'keeps %s classified as a data-model fault once throttling climbs under sustained load',
    (fileName) => {
      const scenario = readScenario(fileName);
      const sustainedLoad = {
        ...scenario.telemetry,
        cosmos429Count: 140,
        ruUsage: 4200,
        latencyP99Ms: 3100,
      };

      const report = classifyIncident(sustainedLoad);

      expect(report.primaryClassification).toBe('DATABASE_CONFIG_OR_DATA_MODEL');
      expect(report.confidence).toBe('HIGH');
      expect(report.primaryOwner).toBe('Contoso Retail data platform team');
    },
  );

  it('still reports a client-side fault when an application access pattern is the active one', () => {
    const scenario = readScenario('hot-partition-429.json');
    const sustainedLoad = { ...scenario.telemetry, cosmos429Count: 140, ruUsage: 4200, latencyP99Ms: 3100 };

    const report = classifyIncident(sustainedLoad);

    expect(report.primaryClassification).toBe('APPLICATION_OR_CLIENT_SIDE');
    expect(report.primaryOwner).toBe('Contoso Retail application engineering');
  });

  // Throttling is the slowest signal to appear for these two: they show up as RU
  // burn and client-side latency first, so gating only on 429 volume left them
  // unclassifiable for the opening minutes of a demo.
  it.each(['metadata-throttling.json', 'large-document-write.json'])(
    'classifies %s from RU and latency evidence before throttling accumulates',
    (fileName) => {
      const scenario = readScenario(fileName);
      const beforeThrottling = { ...scenario.telemetry, cosmos429Count: 0 };

      const report = classifyIncident(beforeThrottling);

      expect(report.primaryClassification).toBe('APPLICATION_OR_CLIENT_SIDE');
      expect(report.confidence).toBe('HIGH');
    },
  );

  it('does not classify a healthy system just because Cosmos is busy', () => {
    const scenario = readScenario('healthy-baseline.json');
    // Volume alone, with no toggle active and Cosmos answering quickly.
    const busyButHealthy = { ...scenario.telemetry, ruUsage: 4200, cosmos429Count: 0 };

    const report = classifyIncident(busyButHealthy);

    expect(report.primaryClassification).toBe('INSUFFICIENT_EVIDENCE');
    expect(report.confidence).toBe('LOW');
  });

  // sqlQueryLatencyMs is a mean over the telemetry window, so steady-state fast
  // SQL calls dilute a slow-query burn below the latency gate until enough slow
  // samples accumulate. Against real Azure SQL the same 2s burn classified as
  // INSUFFICIENT_EVIDENCE at 45s of warm-up and SQL_DATABASE_OR_SCHEMA at 60s.
  it('classifies a SQL fault from error counts while the latency mean is still diluted', () => {
    const scenario = readScenario('sql-slow-query.json');
    const dilutedMean = { ...scenario.telemetry, sqlQueryLatencyMs: 420, sqlErrorCount: 26 };

    const report = classifyIncident(dilutedMean);

    expect(report.primaryClassification).toBe('SQL_DATABASE_OR_SCHEMA');
    expect(report.confidence).toBe('HIGH');
  });

  it('does not raise a SQL fault from errors alone when no SQL toggle is active', () => {
    const scenario = readScenario('healthy-baseline.json');
    const errorsWithoutSqlFault = { ...scenario.telemetry, sqlErrorCount: 26 };

    const report = classifyIncident(errorsWithoutSqlFault);

    expect(report.primaryClassification).not.toBe('SQL_DATABASE_OR_SCHEMA');
  });
});
