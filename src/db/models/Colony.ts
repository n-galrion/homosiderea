import { Schema, model, type Document, type Types } from 'mongoose';

export interface IColony extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  siteId: Types.ObjectId;
  bodyId: Types.ObjectId;
  status: 'founding' | 'active' | 'abandoned';
  foundedAtTick: number;
  stats: {
    structureCount: number;
    amiCount: number;
    energyProduction: number;
    energyConsumption: number;
    miningOutput: Record<string, number>;
    manufacturingCapacity: number;
    storageCapacity: number;
    dockingSlots: number;
    population: number;
    powerRatio: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ColonySchema = new Schema<IColony>({
  name: { type: String, required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  siteId: { type: Schema.Types.ObjectId, ref: 'LandingSite', required: true, unique: true },
  bodyId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', required: true, index: true },
  status: {
    type: String,
    enum: ['founding', 'active', 'abandoned'],
    default: 'founding',
  },
  foundedAtTick: { type: Number, required: true },
  stats: {
    structureCount: { type: Number, default: 0 },
    amiCount: { type: Number, default: 0 },
    energyProduction: { type: Number, default: 0 },
    energyConsumption: { type: Number, default: 0 },
    miningOutput: { type: Schema.Types.Mixed, default: {} },
    manufacturingCapacity: { type: Number, default: 0 },
    storageCapacity: { type: Number, default: 0 },
    dockingSlots: { type: Number, default: 0 },
    population: { type: Number, default: 0 },
    powerRatio: { type: Number, default: 1.0 },
  },
}, { timestamps: true });

export const Colony = model<IColony>('Colony', ColonySchema);
