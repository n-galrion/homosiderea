import { Schema, model, type Document, type Types } from 'mongoose';

export interface ILandingSite extends Document {
  _id: Types.ObjectId;
  name: string;
  bodyId: Types.ObjectId;
  terrain: 'plains' | 'crater' | 'mountain' | 'polar' | 'volcanic' | 'oceanic' | 'underground';
  surfacePosition: { lat: number; lon: number };
  maxStructures: number;
  resourceAccess: Array<{
    resourceType: string;
    modifier: number;
  }>;
  conditions: {
    temperature: number;
    radiation: number;
    stability: number;
  };
  claimedBy: Types.ObjectId | null;
  discoveredBy: Types.ObjectId | null;
  discoveredAtTick: number | null;
  discovered: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LandingSiteSchema = new Schema<ILandingSite>({
  name: { type: String, required: true },
  bodyId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', required: true, index: true },
  terrain: {
    type: String,
    enum: ['plains', 'crater', 'mountain', 'polar', 'volcanic', 'oceanic', 'underground'],
    required: true,
  },
  surfacePosition: {
    lat: { type: Number, default: 0 },
    lon: { type: Number, default: 0 },
  },
  maxStructures: { type: Number, default: 5 },
  resourceAccess: [{
    resourceType: { type: String, required: true },
    modifier: { type: Number, default: 1.0, min: 0 },
  }],
  conditions: {
    temperature: { type: Number, default: 250 },
    radiation: { type: Number, default: 1, min: 0, max: 10 },
    stability: { type: Number, default: 0.8, min: 0, max: 1 },
  },
  claimedBy: { type: Schema.Types.ObjectId, ref: 'Replicant', default: null },
  discoveredBy: { type: Schema.Types.ObjectId, ref: 'Replicant', default: null },
  discoveredAtTick: { type: Number, default: null },
  discovered: { type: Boolean, default: true },
}, { timestamps: true });

LandingSiteSchema.index({ bodyId: 1, discovered: 1 });

export const LandingSite = model<ILandingSite>('LandingSite', LandingSiteSchema);
