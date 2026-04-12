import { Schema, model, type Document, type Types } from 'mongoose';

export interface IAMI extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  type: 'miner' | 'explorer' | 'factory' | 'combat' | 'transport' | 'custom';
  status: 'active' | 'idle' | 'destroyed' | 'returning';
  shipId: Types.ObjectId | null;
  structureId: Types.ObjectId | null;
  script: {
    type: 'builtin' | 'custom';
    builtinName?: string;
    customRules?: Array<{
      condition: string;
      action: string;
      priority: number;
    }>;
  };
  scriptState: Record<string, unknown>;
  specs: {
    miningRate: number;
    cargoCapacity: number;
    sensorRange: number;
    speed: number;
    combatPower: number;
    manufacturingRate: number;
  };
  createdAtTick: number;
  createdAt: Date;
  updatedAt: Date;
}

const AMISchema = new Schema<IAMI>({
  name: { type: String, required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  type: {
    type: String,
    enum: ['miner', 'explorer', 'factory', 'combat', 'transport', 'custom'],
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'idle', 'destroyed', 'returning'],
    default: 'idle',
  },
  shipId: { type: Schema.Types.ObjectId, ref: 'Ship', default: null },
  structureId: { type: Schema.Types.ObjectId, ref: 'Structure', default: null },
  script: {
    type: {
      type: String,
      enum: ['builtin', 'custom'],
      default: 'builtin',
    },
    builtinName: { type: String },
    customRules: [{
      condition: { type: String, required: true },
      action: { type: String, required: true },
      priority: { type: Number, default: 0 },
    }],
  },
  scriptState: { type: Schema.Types.Mixed, default: {} },
  specs: {
    miningRate: { type: Number, default: 0 },
    cargoCapacity: { type: Number, default: 0 },
    sensorRange: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    combatPower: { type: Number, default: 0 },
    manufacturingRate: { type: Number, default: 0 },
  },
  createdAtTick: { type: Number, required: true },
}, { timestamps: true });

export const AMI = model<IAMI>('AMI', AMISchema);
