import { Schema, model, type Document, type Types } from 'mongoose';

export interface IReplicant extends Document {
  _id: Types.ObjectId;
  name: string;
  apiKey: string;
  parentId: Types.ObjectId | null;
  lineage: Types.ObjectId[];
  directive: string;
  status: 'active' | 'dormant' | 'destroyed';
  locationRef: {
    kind: 'Ship' | 'Structure';
    item: Types.ObjectId;
  } | null;
  computeCycles: number;
  energyBudget: number;
  // Tech level summary (aggregated from owned technologies)
  techLevels: Record<string, number>;
  // Access control
  accessControl: {
    // Replicants allowed to modify this replicant's directive
    authorizedModifiers: Types.ObjectId[];
    // Replicants allowed to read private data (memories, scan data)
    authorizedReaders: Types.ObjectId[];
    // Whether physical proximity grants access (docked at same structure)
    physicalAccessEnabled: boolean;
    // Security level (affects hacking difficulty)
    securityLevel: number;
  };
  // Reboot tracking
  lastRebootTick: number | null;
  rebootCount: number;
  createdAtTick: number;
  lastActiveTick: number;
  createdAt: Date;
  updatedAt: Date;
}

const ReplicantSchema = new Schema<IReplicant>({
  name: { type: String, required: true, unique: true },
  apiKey: { type: String, required: true, unique: true, index: true },
  parentId: { type: Schema.Types.ObjectId, ref: 'Replicant', default: null },
  lineage: [{ type: Schema.Types.ObjectId, ref: 'Replicant' }],
  directive: { type: String, default: '' },
  status: {
    type: String,
    enum: ['active', 'dormant', 'destroyed'],
    default: 'active',
  },
  locationRef: {
    type: {
      kind: { type: String, enum: ['Ship', 'Structure'], required: true },
      item: { type: Schema.Types.ObjectId, refPath: 'locationRef.kind', required: true },
    },
    default: null,
  },
  computeCycles: { type: Number, default: 1000 },
  energyBudget: { type: Number, default: 100 },
  techLevels: { type: Schema.Types.Mixed, default: {} },
  accessControl: {
    authorizedModifiers: [{ type: Schema.Types.ObjectId, ref: 'Replicant' }],
    authorizedReaders: [{ type: Schema.Types.ObjectId, ref: 'Replicant' }],
    physicalAccessEnabled: { type: Boolean, default: true },
    securityLevel: { type: Number, default: 1 },
  },
  lastRebootTick: { type: Number, default: null },
  rebootCount: { type: Number, default: 0 },
  createdAtTick: { type: Number, required: true },
  lastActiveTick: { type: Number, default: 0 },
}, { timestamps: true });

export const Replicant = model<IReplicant>('Replicant', ReplicantSchema);
