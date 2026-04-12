import { Schema, model, type Document, type Types } from 'mongoose';

export interface INavigationData extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  type: 'route' | 'orbital_prediction' | 'hazard_map' | 'gravity_well' | 'transit_window';
  name: string;
  description: string;
  // Route data
  route: {
    fromBodyId: Types.ObjectId | null;
    toBodyId: Types.ObjectId | null;
    waypoints: Array<{ x: number; y: number; z: number; tick: number }>;
    estimatedFuelCost: number;
    estimatedTravelTicks: number;
    optimalDepartureTick: number | null;
  } | null;
  // Orbital/hazard data
  spatialData: {
    center: { x: number; y: number; z: number };
    radius: number;
    hazardLevel: number;
    notes: string;
  } | null;
  quality: {
    accuracy: number;
    computedAtTick: number;
    techLevelAtCompute: number;
    staleAfterTicks: number;
  };
  shared: boolean;
  sharedWith: Types.ObjectId[];
  computedAtTick: number;
  createdAt: Date;
  updatedAt: Date;
}

const NavigationDataSchema = new Schema<INavigationData>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  type: {
    type: String,
    enum: ['route', 'orbital_prediction', 'hazard_map', 'gravity_well', 'transit_window'],
    required: true,
  },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  route: {
    type: {
      fromBodyId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', default: null },
      toBodyId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', default: null },
      waypoints: [{ x: Number, y: Number, z: Number, tick: Number }],
      estimatedFuelCost: { type: Number },
      estimatedTravelTicks: { type: Number },
      optimalDepartureTick: { type: Number, default: null },
    },
    default: null,
  },
  spatialData: {
    type: {
      center: { x: Number, y: Number, z: Number },
      radius: { type: Number },
      hazardLevel: { type: Number },
      notes: { type: String },
    },
    default: null,
  },
  quality: {
    accuracy: { type: Number, default: 0.5 },
    computedAtTick: { type: Number },
    techLevelAtCompute: { type: Number, default: 0 },
    staleAfterTicks: { type: Number, default: 1000 },
  },
  shared: { type: Boolean, default: false },
  sharedWith: [{ type: Schema.Types.ObjectId, ref: 'Replicant' }],
  computedAtTick: { type: Number, required: true },
}, { timestamps: true });

NavigationDataSchema.index({ ownerId: 1, type: 1 });

export const NavigationData = model<INavigationData>('NavigationData', NavigationDataSchema);
