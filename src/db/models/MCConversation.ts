import { Schema, model, type Document, type Types } from 'mongoose';

export interface IMCProposedAction {
  tool: string;
  args: Record<string, unknown>;
  status: 'pending' | 'applied' | 'discarded';
  result: string | null;
}

export interface IMCMessage {
  role: 'operator' | 'mc';
  content: string;
  tick: number;
  at: Date;
  proposedActions?: IMCProposedAction[];
}

export interface IMCConversation extends Document {
  _id: Types.ObjectId;
  messages: IMCMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const ProposedActionSchema = new Schema<IMCProposedAction>({
  tool: { type: String, required: true },
  args: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'applied', 'discarded'], default: 'pending' },
  result: { type: String, default: null },
}, { _id: true });

const MCMessageSchema = new Schema<IMCMessage>({
  role: { type: String, enum: ['operator', 'mc'], required: true },
  content: { type: String, default: '' },
  tick: { type: Number, default: 0 },
  at: { type: Date, default: Date.now },
  proposedActions: { type: [ProposedActionSchema], default: undefined },
}, { _id: true });

const MCConversationSchema = new Schema<IMCConversation>({
  messages: { type: [MCMessageSchema], default: [] },
}, { timestamps: true });

export const MCConversation = model<IMCConversation>('MCConversation', MCConversationSchema);
