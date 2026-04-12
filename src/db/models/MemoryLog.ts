import { Schema, model, type Document, type Types } from 'mongoose';

export interface IMemoryLog extends Document {
  _id: Types.ObjectId;
  replicantId: Types.ObjectId;
  category: 'note' | 'log' | 'observation' | 'plan' | 'directive_update';
  title: string;
  content: string;
  tags: string[];
  tick: number;
  createdAt: Date;
  updatedAt: Date;
}

const MemoryLogSchema = new Schema<IMemoryLog>({
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  category: {
    type: String,
    enum: ['note', 'log', 'observation', 'plan', 'directive_update'],
    default: 'note',
  },
  title: { type: String, default: '' },
  content: { type: String, required: true },
  tags: [{ type: String }],
  tick: { type: Number, required: true },
}, { timestamps: true });

MemoryLogSchema.index({ replicantId: 1, category: 1 });
MemoryLogSchema.index({ replicantId: 1, tags: 1 });

export const MemoryLog = model<IMemoryLog>('MemoryLog', MemoryLogSchema);
