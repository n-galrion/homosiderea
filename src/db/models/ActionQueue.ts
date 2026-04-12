import { Schema, model, type Document, type Types } from 'mongoose';

export interface IActionQueue extends Document {
  _id: Types.ObjectId;
  replicantId: Types.ObjectId;
  type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  priority: number;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  queuedAtTick: number;
  resolvedAtTick: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const ActionQueueSchema = new Schema<IActionQueue>({
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  type: {
    type: String,
    enum: [
      'scan', 'move', 'mine', 'build_structure', 'build_ship', 'manufacture',
      'refine', 'launch_ami', 'replicate', 'send_message',
      'transfer_resources', 'dock', 'undock', 'attack', 'found_colony',
      'proposed_action',
    ],
    required: true,
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
  },
  priority: { type: Number, default: 0 },
  params: { type: Schema.Types.Mixed, required: true },
  result: { type: Schema.Types.Mixed, default: null },
  error: { type: String, default: null },
  queuedAtTick: { type: Number, required: true },
  resolvedAtTick: { type: Number, default: null },
}, { timestamps: true });

ActionQueueSchema.index({ status: 1, priority: -1 });

export const ActionQueue = model<IActionQueue>('ActionQueue', ActionQueueSchema);
