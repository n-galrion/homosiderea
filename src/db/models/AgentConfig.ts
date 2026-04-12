import { Schema, model, type Document, type Types } from 'mongoose';

export interface IAgentConfig extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  replicantId: Types.ObjectId;
  enabled: boolean;

  provider: {
    baseUrl: string;
    apiKey: string;   // AES-256-GCM encrypted
    model: string;
  };

  sampling: {
    temperature: number;
    topP: number;
    maxTokens: number;
  };

  thinkEveryNTicks: number;
  tokenBudgetPerCycle: number;
  systemPromptOverride: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const AgentConfigSchema = new Schema<IAgentConfig>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, unique: true },
  enabled: { type: Boolean, default: false },

  provider: {
    baseUrl: { type: String, default: 'https://openrouter.ai/api/v1' },
    apiKey: { type: String, default: '' },
    model: { type: String, default: 'anthropic/claude-sonnet-4' },
  },

  sampling: {
    temperature: { type: Number, default: 0.7 },
    topP: { type: Number, default: 1.0 },
    maxTokens: { type: Number, default: 4096 },
  },

  thinkEveryNTicks: { type: Number, default: 5, min: 1, max: 100 },
  tokenBudgetPerCycle: { type: Number, default: 50000, min: 1000, max: 200000 },
  systemPromptOverride: { type: String, default: null },
}, { timestamps: true });

export const AgentConfig = model<IAgentConfig>('AgentConfig', AgentConfigSchema);
