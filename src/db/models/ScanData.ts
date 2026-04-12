import { Schema, model, type Document, type Types } from 'mongoose';

export interface IScanData extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  // What was scanned
  targetType: 'celestial_body' | 'asteroid' | 'ship' | 'structure' | 'area';
  targetId: Types.ObjectId | null;
  targetName: string;
  // Scan quality (affected by tech level)
  quality: {
    accuracy: number;
    resolution: number;
    noiseLevel: number;
    falsePositiveRate: number;
    techLevelAtScan: number;
  };
  // Raw scan results (may contain inaccuracies based on quality)
  data: {
    position: { x: number; y: number; z: number } | null;
    resources: Array<{
      resourceType: string;
      estimatedAbundance: number;
      estimatedDeposit: number;
      confidence: number;
    }> | null;
    composition: string | null;
    physicalProperties: Record<string, number> | null;
    anomalies: string[];
    signatures: Array<{
      type: string;
      strength: number;
      bearing: { x: number; y: number; z: number };
    }>;
  };
  scanTick: number;
  expiresAtTick: number | null;
  shared: boolean;
  sharedWith: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const ScanDataSchema = new Schema<IScanData>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  targetType: {
    type: String,
    enum: ['celestial_body', 'asteroid', 'ship', 'structure', 'area'],
    required: true,
  },
  targetId: { type: Schema.Types.ObjectId, default: null },
  targetName: { type: String, required: true },
  quality: {
    accuracy: { type: Number, default: 0.5 },
    resolution: { type: Number, default: 0.5 },
    noiseLevel: { type: Number, default: 0.5 },
    falsePositiveRate: { type: Number, default: 0.2 },
    techLevelAtScan: { type: Number, default: 0 },
  },
  data: {
    position: {
      type: { x: Number, y: Number, z: Number },
      default: null,
    },
    resources: [{
      resourceType: { type: String },
      estimatedAbundance: { type: Number },
      estimatedDeposit: { type: Number },
      confidence: { type: Number },
    }],
    composition: { type: String, default: null },
    physicalProperties: { type: Schema.Types.Mixed, default: null },
    anomalies: [{ type: String }],
    signatures: [{
      type: { type: String },
      strength: { type: Number },
      bearing: { x: Number, y: Number, z: Number },
    }],
  },
  scanTick: { type: Number, required: true },
  expiresAtTick: { type: Number, default: null },
  shared: { type: Boolean, default: false },
  sharedWith: [{ type: Schema.Types.ObjectId, ref: 'Replicant' }],
}, { timestamps: true });

ScanDataSchema.index({ ownerId: 1, targetType: 1 });

export const ScanData = model<IScanData>('ScanData', ScanDataSchema);
