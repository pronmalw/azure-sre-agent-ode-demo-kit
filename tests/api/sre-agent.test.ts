import { createTestClient } from './test-helpers';

describe('sre-agent endpoints', () => {
  it('GET /api/sre-agent/investigate returns valid report with all fields', async () => {
    const client = createTestClient();
    await client.post('/api/chaos/hotPartition/on');
    await client.get('/api/products');

    const response = await client.get('/api/sre-agent/investigate');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('incidentId');
    expect(response.body).toHaveProperty('primaryClassification');
    expect(response.body).toHaveProperty('secondaryClassifications');
    expect(response.body).toHaveProperty('confidence');
    expect(response.body).toHaveProperty('customerImpact');
    expect(response.body).toHaveProperty('primaryOwner');
    expect(response.body).toHaveProperty('secondaryOwners');
    expect(response.body).toHaveProperty('evidence');
    expect(response.body).toHaveProperty('ruledOutCauses');
    expect(response.body).toHaveProperty('missingEvidence');
    expect(response.body).toHaveProperty('immediateSafeActions');
    expect(response.body).toHaveProperty('approvalRequiredActions');
    expect(response.body).toHaveProperty('doNotDoGuidance');
    expect(response.body).toHaveProperty('escalationRecommendation');
    expect(response.body).toHaveProperty('verificationCriteria');
    expect(response.body).toHaveProperty('executiveSummary');
    expect(response.body).toHaveProperty('engineeringRca');
    expect(response.body).toHaveProperty('teamsUpdate');
  });
});
