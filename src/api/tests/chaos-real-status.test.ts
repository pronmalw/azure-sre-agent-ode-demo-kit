import { createTestClient } from './test-helpers';
import { getChaosService } from '../src/services/chaos.service';
import { getAzureVpnChaosService } from '../src/services/azure-vpn-chaos.service';

jest.mock('../src/services/azure-vpn-chaos.service', () => ({
  getAzureVpnChaosService: jest.fn(),
}));

const mockedGetVpn = getAzureVpnChaosService as unknown as jest.Mock;

/**
 * Waits for the fire-and-forget Azure call behind a toggle to settle. The HTTP
 * request deliberately returns before the control-plane call finishes, so the
 * status is only meaningful once it leaves the 'applying' phase.
 */
const waitForPhase = async (expected: string, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getChaosService().getRealChaosStatus().vpnConnectivityIssue?.phase === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `timed out waiting for phase '${expected}'; last seen ` +
      JSON.stringify(getChaosService().getRealChaosStatus().vpnConnectivityIssue),
  );
};

describe('real Azure chaos status', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('reports the toggle as applied once the VPN call succeeds', async () => {
    const breakTunnel = jest.fn().mockResolvedValue({ status: 'down' });
    mockedGetVpn.mockReturnValue({
      isEnabled: () => true,
      breakTunnel,
      healTunnel: jest.fn().mockResolvedValue({ status: 'connected' }),
    });

    const client = createTestClient();
    await client.post('/api/chaos/vpnConnectivityIssue/on');
    await waitForPhase('applied');

    const response = await client.get('/api/chaos/status');
    expect(response.status).toBe(200);
    expect(response.body.toggles.vpnConnectivityIssue).toBe(true);
    expect(response.body.realChaos.vpnConnectivityIssue.phase).toBe('applied');
    expect(response.body.unappliedToggles).toEqual([]);
    expect(response.body.inSync).toBe(true);
    expect(breakTunnel).toHaveBeenCalledTimes(1);
  });

  it('retries a transient control-plane failure instead of giving up on the first error', async () => {
    const breakTunnel = jest
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue({ status: 'down' });
    mockedGetVpn.mockReturnValue({
      isEnabled: () => true,
      breakTunnel,
      healTunnel: jest.fn(),
    });

    const client = createTestClient();
    await client.post('/api/chaos/vpnConnectivityIssue/on');
    await waitForPhase('applied', 20_000);

    expect(breakTunnel).toHaveBeenCalledTimes(2);
    expect(getChaosService().getUnappliedToggles()).toEqual([]);
  }, 30_000);

  it('surfaces a toggle that is on but was never applied to Azure', async () => {
    // This is the failure that silently broke a live demo: every attempt fails,
    // but the toggle still reads "on" while the real tunnel stays healthy.
    const breakTunnel = jest.fn().mockRejectedValue(new Error('fetch failed'));
    mockedGetVpn.mockReturnValue({
      isEnabled: () => true,
      breakTunnel,
      healTunnel: jest.fn(),
    });

    const client = createTestClient();
    await client.post('/api/chaos/vpnConnectivityIssue/on');
    await waitForPhase('failed', 30_000);

    const response = await client.get('/api/chaos/status');
    expect(response.body.toggles.vpnConnectivityIssue).toBe(true);
    expect(response.body.realChaos.vpnConnectivityIssue.phase).toBe('failed');
    expect(response.body.realChaos.vpnConnectivityIssue.error).toContain('fetch failed');
    expect(response.body.unappliedToggles).toContain('vpnConnectivityIssue');
    expect(response.body.inSync).toBe(false);
    expect(breakTunnel).toHaveBeenCalledTimes(3);
  }, 40_000);

  it('marks the toggle not-applicable when Azure VPN chaos is not configured', async () => {
    mockedGetVpn.mockReturnValue({
      isEnabled: () => false,
      breakTunnel: jest.fn(),
      healTunnel: jest.fn(),
    });

    const client = createTestClient();
    await client.post('/api/chaos/vpnConnectivityIssue/on');

    const response = await client.get('/api/chaos/status');
    expect(response.body.realChaos.vpnConnectivityIssue.phase).toBe('not-applicable');
    expect(response.body.inSync).toBe(true);
  });
});
