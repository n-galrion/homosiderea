import { Schema, model, type Document, type Types } from 'mongoose';

export interface ITick extends Document {
  _id: Types.ObjectId;
  tickNumber: number;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  actionsProcessed: number;
  amisExecuted: number;
  messagesDelivered: number;
  resourcesProduced: Record<string, number>;
  tickErrors: string[];
}

const TickSchema = new Schema<ITick>({
  tickNumber: { type: Number, required: true, unique: true },
  startedAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },
  durationMs: { type: Number, default: null },
  actionsProcessed: { type: Number, default: 0 },
  amisExecuted: { type: Number, default: 0 },
  messagesDelivered: { type: Number, default: 0 },
  resourcesProduced: { type: Schema.Types.Mixed, default: {} },
  tickErrors: [{ type: String }],
}, { timestamps: true });

export const Tick = model<ITick>('Tick', TickSchema);
