import { Schema, model, type Document, type Types } from 'mongoose';

export interface INotification extends Document {
  _id: Types.ObjectId;
  type: 'replicant_spawned' | 'ship_destroyed' | 'colony_founded' | 'research_complete' | 'pirate_attack' | 'settlement_event';
  title: string;
  body: string;
  data: Record<string, unknown>;
  read: boolean;
  tick: number;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  type: {
    type: String,
    enum: ['replicant_spawned', 'ship_destroyed', 'colony_founded', 'research_complete', 'pirate_attack', 'settlement_event'],
    required: true,
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  data: { type: Schema.Types.Mixed, default: {} },
  read: { type: Boolean, default: false },
  tick: { type: Number, required: true },
}, { timestamps: true });

NotificationSchema.index({ read: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', NotificationSchema);
