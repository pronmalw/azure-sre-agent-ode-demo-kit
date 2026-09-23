import { getCpuLoadService } from '../src/services/cpu-load.service';

/**
 * The incident classifier only reports HOST_OR_RUNTIME when host CPU exceeds
 * 70%. The burn therefore has to clear that bar on a real process, not just in
 * the scenario fixtures: a budget that lands below it makes the highCpu
 * scenario unclassifiable no matter how long the demo runs.
 *
 * CPU is measured here directly from process.cpuUsage() rather than through the
 * service's own sampler, so the assertion does not depend on the five second
 * sampling interval.
 */
const measureCpuPercent = async (windowMs: number): Promise<number> => {
  const startUsage = process.cpuUsage();
  const startedAt = process.hrtime.bigint();

  await new Promise((resolve) => setTimeout(resolve, windowMs));

  const elapsedMicros = Number(process.hrtime.bigint() - startedAt) / 1000;
  const endUsage = process.cpuUsage();
  const cpuMicros = endUsage.user - startUsage.user + (endUsage.system - startUsage.system);

  return (cpuMicros / elapsedMicros) * 100;
};

describe('cpu load service', () => {
  afterEach(() => {
    getCpuLoadService().setBurnEnabled(false);
  });

  it('burns enough real CPU to clear the host saturation threshold', async () => {
    const service = getCpuLoadService();

    const idlePercent = await measureCpuPercent(1_000);
    expect(idlePercent).toBeLessThan(50);

    service.setBurnEnabled(true);
    expect(service.isBurning()).toBe(true);

    const burningPercent = await measureCpuPercent(3_000);
    expect(burningPercent).toBeGreaterThan(70);
  }, 20_000);

  it('yields often enough that the event loop keeps being serviced', async () => {
    const service = getCpuLoadService();
    service.setBurnEnabled(true);

    // A starved event loop is what previously caused the Kubernetes health
    // probe to time out and the pod to be killed mid-scenario.
    const delays: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const startedAt = Date.now();
      await new Promise((resolve) => setImmediate(resolve));
      delays.push(Date.now() - startedAt);
    }

    expect(Math.max(...delays)).toBeLessThan(60);
  }, 20_000);

  it('stops burning when disabled', async () => {
    const service = getCpuLoadService();
    service.setBurnEnabled(true);
    service.setBurnEnabled(false);

    expect(service.isBurning()).toBe(false);
    const idlePercent = await measureCpuPercent(1_000);
    expect(idlePercent).toBeLessThan(50);
  }, 20_000);
});
