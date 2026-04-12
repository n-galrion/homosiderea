import { Schema, model, type Document, type Types } from 'mongoose';

export interface IStructure extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  type: 'habitat' | 'mine' | 'refinery' | 'factory' | 'solar_array' |
        'fusion_plant' | 'shipyard' | 'sensor_station' | 'relay_station';
  status: 'building' | 'operational' | 'damaged' | 'destroyed';
  bodyId: Types.ObjectId;
  siteId: Types.ObjectId | null;
  colonyId: Types.ObjectId | null;
  construction: {
    complete: boolean;
    progressTicks: number;
    requiredTicks: number;
  };
  specs: {
    miningRate: number;
    refiningRate: number;
    manufacturingRate: number;
    energyOutput: number;
    energyConsumption: number;
    sensorRange: number;
    dockingSlots: number;
    storageCapacity: number;
  };
  hullPoints: number;
  maxHullPoints: number;
  createdAtTick: number;
  createdAt: Date;
  updatedAt: Date;
}

const StructureSchema = new Schema<IStructure>({
  name: { type: String, required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  type: {
    type: String,
    enum: [
      'habitat', 'mine', 'refinery', 'factory', 'solar_array',
      'fusion_plant', 'shipyard', 'sensor_station', 'relay_station', 'cargo_depot',
    ],
    required: true,
  },
  status: {
    type: String,
    enum: ['building', 'operational', 'damaged', 'destroyed'],
    default: 'building',
  },
  bodyId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', required: true },
  siteId: { type: Schema.Types.ObjectId, ref: 'LandingSite', default: null },
  colonyId: { type: Schema.Types.ObjectId, ref: 'Colony', default: null },
  construction: {
    complete: { type: Boolean, default: false },
    progressTicks: { type: Number, default: 0 },
    requiredTicks: { type: Number, required: true },
  },
  specs: {
    miningRate: { type: Number, default: 0 },
    refiningRate: { type: Number, default: 0 },
    manufacturingRate: { type: Number, default: 0 },
    energyOutput: { type: Number, default: 0 },
    energyConsumption: { type: Number, default: 0 },
    sensorRange: { type: Number, default: 0 },
    dockingSlots: { type: Number, default: 0 },
    storageCapacity: { type: Number, default: 500 },
  },
  hullPoints: { type: Number, default: 500 },
  maxHullPoints: { type: Number, default: 500 },
  createdAtTick: { type: Number, required: true },
}, { timestamps: true });

export const Structure = model<IStructure>('Structure', StructureSchema);
