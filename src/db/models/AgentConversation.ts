import { Schema, model, type Document, type Types } from 'mongoose';

export interface IStoredToolCall { id: string; name: string; args: string }

export interface IStoredMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: IStoredToolCall[];
  toolCallId?: string;
  name?: string;
  tick: number;
  at: Date;
}

export interface IAgentConversation extends Document {
  _id: Types.ObjectId;
  replicantId: Types.ObjectId;
  messages: IStoredMessage[];
  summary: string | null;
  summarizedThroughTick: number;
  lastResumeTick: number;
  createdAt: Date;
  updatedAt: Date;
}

const StoredToolCallSchema = new Schema<IStoredToolCall>({
  id: { type: String, required: true },
  name: { type: String, required: true },
  args: { type: String, default: '{}' },
}, { _id: false });

const StoredMessageSchema = new Schema<IStoredMessage>({
  role: { type: String, enum: ['system', 'user', 'assistant', 'tool'], required: true },
  content: { type: String, default: null },
  toolCalls: { type: [StoredToolCallSchema], default: undefined },
  toolCallId: { type: String, default: undefined },
  name: { type: String, default: undefined },
  tick: { type: Number, default: 0 },
  at: { type: Date, default: Date.now },
}, { _id: false });

const AgentConversationSchema = new Schema<IAgentConversation>({
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, unique: true, index: true },
  messages: { type: [StoredMessageSchema], default: [] },
  summary: { type: String, default: null },
  summarizedThroughTick: { type: Number, default: 0 },
  lastResumeTick: { type: Number, default: 0 },
}, { timestamps: true });

export const AgentConversation = model<IAgentConversation>('AgentConversation', AgentConversationSchema);
