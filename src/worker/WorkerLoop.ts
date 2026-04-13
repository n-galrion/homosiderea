import { Redis } from 'ioredis';
import { Queue, Worker as BullMQWorker, type Job } from 'bullmq';
import { nanoid } from 'nanoid';
import { AgentConfig, AgentSession, Replicant } from '../db/models/index.js';
import { AgentRunner } from './AgentRunner.js';
import { RestGameClient } from './RestGameClient.js';
import { DirectGameClient } from './DirectGameClient.js';
import { config } from '../config.js';
import type { IGameClient } from './IGameClient.js';
import type { IAgentConfig } from '../db/models/AgentConfig.js';

const QUEUE_NAME = 'agent-cycles';
const SCHEDULER_LOCK_TTL = 30; // seconds

interface AgentJobData {
  replicantId: string;
  tick: number;
}

/**
 * Agent worker with BullMQ-based job queue and exactly-once tick scheduling.
 *
 * Architecture:
 *   1. All workers subscribe to Redis `tick:complete` pub/sub
 *   2. For each tick, exactly ONE worker wins a scheduler lock and enqueues
 *      one job per due agent. Losers skip.
 *   3. All workers consume jobs from the BullMQ queue with configurable
 *      concurrency. Jobs are distributed naturally — no lock contention.
 *
 * Scale horizontally with `docker compose up --scale agent-worker=N`.
 * Each worker handles `WORKER_CONCURRENCY` agents in parallel.
 */
export class WorkerLoop {
  private subscriber: Redis;
  private locker: Redis;
  private queueConnection: Redis;
  private workerConnection: Redis;
  private queue: Queue<AgentJobData>;
  private bullWorker: BullMQWorker<AgentJobData> | null = null;
  private workerId: string;
  private running = false;

  constructor() {
    // BullMQ requires maxRetriesPerRequest=null for worker connections
    this.queueConnection = new Redis(config.redis.url, { maxRetriesPerRequest: null });
    this.workerConnection = new Redis(config.redis.url, { maxRetriesPerRequest: null });
    this.subscriber = new Redis(config.redis.url);
    this.locker = new Redis(config.redis.url);
    this.workerId = `worker-${nanoid(8)}`;
    this.queue = new Queue<AgentJobData>(QUEUE_NAME, { connection: this.queueConnection });
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[Worker ${this.workerId}] Starting (mode=${config.worker.mode}, concurrency=${config.worker.concurrency})`);

    // Start consuming jobs
    this.bullWorker = new BullMQWorker<AgentJobData>(
      QUEUE_NAME,
      async (job: Job<AgentJobData>) => this.executeJob(job),
      {
        connection: this.workerConnection,
        concurrency: config.worker.concurrency,
      },
    );

    this.bullWorker.on('failed', (job, err) => {
      console.error(`[Worker ${this.workerId}] Job ${job?.id} failed:`, err.message);
    });

    // Listen for tick events and try to become the scheduler
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const { tick } = JSON.parse(message) as { tick: number };
        void this.onTickComplete(tick);
      } catch (err) {
        console.error(`[Worker ${this.workerId}] Failed to parse tick event:`, err);
      }
    });

    await this.subscriber.subscribe('tick:complete');
    console.log(`[Worker ${this.workerId}] Listening for ticks and consuming jobs from ${QUEUE_NAME}`);
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log(`[Worker ${this.workerId}] Draining jobs and shutting down...`);

    try {
      await this.subscriber.unsubscribe('tick:complete');
    } catch { /* ignore */ }

    // Let in-flight jobs finish before disconnecting
    if (this.bullWorker) {
      await this.bullWorker.close();
    }
    await this.queue.close();

    this.subscriber.disconnect();
    this.locker.disconnect();
    this.queueConnection.disconnect();
    this.workerConnection.disconnect();
    console.log(`[Worker ${this.workerId}] Stopped`);
  }

  /**
   * Tick completed — try to become the scheduler for this tick and enqueue
   * jobs for any due agents. Only one worker wins the lock per tick.
   */
  private async onTickComplete(tick: number): Promise<void> {
    if (!this.running) return;

    const lockKey = `tick:scheduler:${tick}`;
    const acquired = await this.locker.set(lockKey, this.workerId, 'EX', SCHEDULER_LOCK_TTL, 'NX');
    if (acquired !== 'OK') {
      // Another worker is scheduling this tick
      return;
    }

    try {
      const dueConfigs = await AgentConfig.find({ enabled: true }).lean();
      const dueThisTick = dueConfigs.filter(c => tick % c.thinkEveryNTicks === 0);

      if (dueThisTick.length === 0) return;

      console.log(`[Worker ${this.workerId}] Scheduling tick ${tick}: ${dueThisTick.length} agent(s) due`);

      // Enqueue one job per agent. Use jobId for deduplication in case of
      // double-enqueue (BullMQ will reject duplicates with the same jobId).
      const jobs = dueThisTick.map(c => ({
        name: 'cycle',
        data: { replicantId: c.replicantId.toString(), tick },
        opts: {
          jobId: `cycle:${c.replicantId.toString()}:${tick}`,
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }));

      await this.queue.addBulk(jobs);
    } catch (err) {
      console.error(`[Worker ${this.workerId}] Scheduler error:`, err);
    }
  }

  /**
   * BullMQ job handler — runs one agent's think cycle.
   */
  private async executeJob(job: Job<AgentJobData>): Promise<void> {
    const { replicantId, tick } = job.data;

    const agentConfig = await AgentConfig.findOne({ replicantId });
    if (!agentConfig || !agentConfig.enabled) return;

    let session = await AgentSession.findOne({ replicantId });
    if (!session) {
      session = await AgentSession.create({ replicantId, status: 'running' });
    }

    if (session.status === 'paused' || session.status === 'stopped') return;

    const replicant = await Replicant.findById(replicantId);
    if (!replicant || replicant.status !== 'active') return;

    const client: IGameClient = config.worker.mode === 'direct'
      ? new DirectGameClient(replicantId)
      : new RestGameClient(replicant.apiKey);

    const runner = new AgentRunner(
      agentConfig as unknown as IAgentConfig,
      replicant,
      tick,
      client,
    );
    await runner.run();
  }
}
