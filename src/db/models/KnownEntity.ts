import { Schema, model, type Document, type Types } from 'mongoose';

/**
 * Tracks what a replicant knows about the universe.
 * You only see what you've scanned, been told about, or can detect.
 */
export interface IKnownEntity extends Document {
  _id: Types.ObjectId;
  replicantId: Types.ObjectId;
  entityType: 'celestial_body' | 'asteroid' | 'ship' | 'structure' | 'settlement' | 'replicant';
  entityId: Types.ObjectId;
  entityName: string;
  discoveredAtTick: number;
  discoveredBy: 'initial' | 'scan' | 'visit' | 'shared' | 'broadcast' | 'research';
  lastUpdatedTick: number;
  // Cached position (may be stale if not recently scanned)
  lastKnownPosition: { x: number; y: number; z: number } | null;
  // Quality of intel
  intelLevel: 'vague' | 'basic' | 'detailed' | 'complete';
}

const KnownEntitySchema = new Schema<IKnownEntity>({
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  entityType: {
    type: String,
    enum: ['celestial_body', 'asteroid', 'ship', 'structure', 'settlement', 'replicant'],
    required: true,
  },
  entityId: { type: Schema.Types.ObjectId, required: true },
  entityName: { type: String, required: true },
  discoveredAtTick: { type: Number, required: true },
  discoveredBy: {
    type: String,
    enum: ['initial', 'scan', 'visit', 'shared', 'broadcast', 'research'],
    default: 'scan',
  },
  lastUpdatedTick: { type: Number, required: true },
  lastKnownPosition: {
    type: { x: Number, y: Number, z: Number },
    default: null,
  },
  intelLevel: {
    type: String,
    enum: ['vague', 'basic', 'detailed', 'complete'],
    default: 'basic',
  },
}, { timestamps: true });

KnownEntitySchema.index({ replicantId: 1, entityType: 1, entityId: 1 }, { unique: true });

export const KnownEntity = model<IKnownEntity>('KnownEntity', KnownEntitySchema);
