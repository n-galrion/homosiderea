import { Redis } from 'ioredis';
import { nanoid } from 'nanoid';
import { AgentConfig, AgentSession, Replicant } from '../db/models/index.js';
import { AgentRunner } from './AgentRunner.js';
import { config } from '../config.js';
import type { IAgentConfig } from '../db/models/AgentConfig.js';

const LOCK_TTL_SECONDS = 120;

export class WorkerLoop {
  private subscriber: Redis;
  private locker: Redis;
  private workerId: string;
  private running = false;

  constructor() {
    this.subscriber = new Redis(config.redis.url);
    this.locker = new Redis(config.redis.url);
    this.workerId = `worker-${nanoid(8)}`;
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[Worker ${this.workerId}] Starting, subscribing to tick:complete`);

    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const { tick } = JSON.parse(message) as { tick: number };
        void this.onTickComplete(tick);
      } catch (err) {
        console.error('[Worker] Failed to parse tick event:', err);
      }
    });

    await this.subscriber.subscribe('tick:complete');
    console.log(`[Worker ${this.workerId}] Listening for tick events`);
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.subscriber.unsubscribe('tick:complete');
    this.subscriber.disconnect();
    this.locker.disconnect();
    console.log(`[Worker ${this.workerId}] Stopped`);
  }

  private async onTickComplete(tick: number): Promise<void> {
    if (!this.running) return;

    const dueConfigs = await AgentConfig.find({ enabled: true }).lean();
    const dueThisTick = dueConfigs.filter(c => tick % c.thinkEveryNTicks === 0);

    if (dueThisTick.length === 0) return;

    console.log(`[Worker ${this.workerId}] Tick ${tick}: ${dueThisTick.length} agent(s) due`);

    const promises = dueThisTick.map(c => this.runAgent(c as unknown as IAgentConfig, tick));
    await Promise.allSettled(promises);
  }

  private async runAgent(agentConfig: IAgentConfig, tick: number): Promise<void> {
    const replicantId = agentConfig.replicantId.toString();
    const lockKey = `agent:lock:${replicantId}`;

    const acquired = await this.locker.set(lockKey, this.workerId, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (!acquired) return;

    try {
      let session = await AgentSession.findOne({ replicantId: agentConfig.replicantId });
      if (!session) {
        session = await AgentSession.create({ replicantId: agentConfig.replicantId, status: 'running' });
      }

      if (session.status === 'paused' || session.status === 'stopped') return;

      const replicant = await Replicant.findById(agentConfig.replicantId);
      if (!replicant || replicant.status !== 'active') return;

      const runner = new AgentRunner(agentConfig, replicant, tick);
      await runner.run();
    } catch (err) {
      console.error(`[Worker] Agent ${replicantId} error:`, err);
    } finally {
      await this.locker.del(lockKey).catch(() => {});
    }
  }
}
