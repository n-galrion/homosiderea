import { Schema, model, type Document, type Types } from 'mongoose';

export interface IMessage extends Document {
  _id: Types.ObjectId;
  senderId: Types.ObjectId;
  recipientId: Types.ObjectId | null;
  subject: string;
  body: string;
  metadata: Record<string, unknown>;
  senderPosition: { x: number; y: number; z: number };
  recipientPosition: { x: number; y: number; z: number };
  distanceAU: number;
  sentAtTick: number;
  deliverAtTick: number;
  delivered: boolean;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>({
  senderId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true },
  recipientId: { type: Schema.Types.ObjectId, ref: 'Replicant', default: null },
  subject: { type: String, default: '' },
  body: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  senderPosition: {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    z: { type: Number, required: true },
  },
  recipientPosition: {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    z: { type: Number, required: true },
  },
  distanceAU: { type: Number, required: true },
  sentAtTick: { type: Number, required: true },
  deliverAtTick: { type: Number, required: true },
  delivered: { type: Boolean, default: false, index: true },
  read: { type: Boolean, default: false },
}, { timestamps: true });

MessageSchema.index({ recipientId: 1, delivered: 1, deliverAtTick: 1 });

export const Message = model<IMessage>('Message', MessageSchema);
