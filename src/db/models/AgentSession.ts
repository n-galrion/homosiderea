import { Schema, model, type Document, type Types } from 'mongoose';

export interface ICycleEntry {
  tick: number;
  tokensUsed: number;
  toolCalls: number;
  durationMs: number;
  error: string | null;
}

export interface IAgentSession extends Document {
  _id: Types.ObjectId;
  replicantId: Types.ObjectId;
  status: 'running' | 'paused' | 'stopped' | 'error';
  lastCycleTick: number;
  lastCycleAt: Date | null;
  lastError: string | null;
  consecutiveErrors: number;

  totalCycles: number;
  totalTokensUsed: number;
  totalToolCalls: number;

  cycleHistory: ICycleEntry[];

  createdAt: Date;
  updatedAt: Date;
}

const AgentSessionSchema = new Schema<IAgentSession>({
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, unique: true },
  status: {
    type: String,
    enum: ['running', 'paused', 'stopped', 'error'],
    default: 'stopped',
  },
  lastCycleTick: { type: Number, default: 0 },
  lastCycleAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  consecutiveErrors: { type: Number, default: 0 },

  totalCycles: { type: Number, default: 0 },
  totalTokensUsed: { type: Number, default: 0 },
  totalToolCalls: { type: Number, default: 0 },

  cycleHistory: [{
    tick: { type: Number, required: true },
    tokensUsed: { type: Number, required: true },
    toolCalls: { type: Number, required: true },
    durationMs: { type: Number, required: true },
    error: { type: String, default: null },
  }],
}, { timestamps: true });

export const AgentSession = model<IAgentSession>('AgentSession', AgentSessionSchema);
