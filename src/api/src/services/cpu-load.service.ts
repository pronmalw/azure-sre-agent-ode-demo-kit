/**
 * Real CPU pressure and real CPU measurement.
 *
 * The demo previously reported a fabricated host CPU number. That is a problem
 * for a live demo: anyone who opens Container Insights would see the real node
 * CPU disagree with the dashboard. This service instead burns actual CPU when
 * the highCpu chaos toggle is on, and reports the process's genuinely measured
 * CPU utilisation.
 */

const SAMPLE_INTERVAL_MS = 5_000;
// Burn window per tick. Node is single threaded, so occupying this much of
// every 100ms drives real utilisation to a matching share of one core while
// still leaving enough event-loop headroom for health probes to answer.
//
// The requested window is not all spent burning: yielding between slices costs
// roughly a millisecond each time, so measured utilisation lands below the
// request. The budget below is sized so the measured figure clears the >70%
// host-saturation threshold the incident classifier uses, with margin.
const BURN_TICK_MS = 100;
const BURN_BUSY_MS = 88;
// The burn is split into short slices with a yield between each one. A single
// unbroken block starves the event loop badly enough that the Kubernetes
// health probe times out and the pod is killed mid-scenario, which wipes the
// in-process chaos state. Slicing consumes the same CPU while keeping the
// longest continuous block short enough for /health to stay responsive.
// Larger slices mean fewer yields, so less of the budget is lost to scheduling.
const BURN_SLICE_MS = 12;

export class CpuLoadService {
  private burnTimer: NodeJS.Timeout | null = null;
  private sampleTimer: NodeJS.Timeout | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastSampleAt = process.hrtime.bigint();
  private currentPercent = 0;

  /** Starts the always-on sampler that measures real process CPU utilisation. */
  startSampling(): void {
    if (this.sampleTimer) {
      return;
    }

    this.sampleTimer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.sampleTimer.unref?.();
  }

  /**
   * Percentage of one CPU core consumed by this process. The API container is
   * limited to 1000m (one core), so this maps directly onto its cgroup quota.
   */
  getCpuPercent(): number {
    return this.currentPercent;
  }

  setBurnEnabled(enabled: boolean): void {
    if (enabled) {
      this.startBurn();
    } else {
      this.stopBurn();
    }
  }

  isBurning(): boolean {
    return this.burnTimer !== null;
  }

  /**
   * Restarts the burn if it is not running. Pods are replicated and can restart
   * mid-demo; without this a restarted pod would report healthy CPU while the
   * chaos toggle still claims the incident is active.
   */
  ensureBurnEnabled(): void {
    this.startBurn();
  }

  private startBurn(): void {
    if (this.burnTimer) {
      return;
    }

    this.burnTimer = setInterval(() => {
      this.burnSlices(BURN_BUSY_MS);
    }, BURN_TICK_MS);
    this.burnTimer.unref?.();
    console.log('[cpu-load] real CPU burn started.');
  }

  /**
   * Burns `totalMs` of CPU in short slices, yielding to the event loop between
   * each one so queued I/O (notably the health probe) still gets served.
   */
  private burnSlices(totalMs: number): void {
    let remaining = totalMs;

    const runSlice = (): void => {
      // Stop early if the burn was switched off part-way through a tick.
      if (!this.burnTimer || remaining <= 0) {
        return;
      }

      const sliceMs = Math.min(BURN_SLICE_MS, remaining);
      const until = Date.now() + sliceMs;
      // Deliberate busy-wait: this is the point, we want real CPU consumption.
      while (Date.now() < until) {
        Math.sqrt(Math.random() * Number.MAX_SAFE_INTEGER);
      }

      remaining -= sliceMs;
      if (remaining > 0) {
        setImmediate(runSlice);
      }
    };

    runSlice();
  }

  private stopBurn(): void {
    if (!this.burnTimer) {
      return;
    }

    clearInterval(this.burnTimer);
    this.burnTimer = null;
    console.log('[cpu-load] real CPU burn stopped.');
  }

  private sample(): void {
    const nowUsage = process.cpuUsage();
    const nowAt = process.hrtime.bigint();

    const elapsedMicros = Number(nowAt - this.lastSampleAt) / 1000;
    const cpuMicros =
      nowUsage.user - this.lastCpuUsage.user + (nowUsage.system - this.lastCpuUsage.system);

    this.lastCpuUsage = nowUsage;
    this.lastSampleAt = nowAt;

    if (elapsedMicros > 0) {
      this.currentPercent = Math.max(0, Math.min(100, Math.round((cpuMicros / elapsedMicros) * 100)));
    }
  }
}

let cpuLoadSingleton: CpuLoadService | undefined;

export const getCpuLoadService = (): CpuLoadService => {
  if (!cpuLoadSingleton) {
    cpuLoadSingleton = new CpuLoadService();
    cpuLoadSingleton.startSampling();
  }

  return cpuLoadSingleton;
};
