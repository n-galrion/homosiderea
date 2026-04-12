import { Schema, model, type Document, type Types } from 'mongoose';

export interface IAsteroid extends Document {
  _id: Types.ObjectId;
  name: string;
  beltZoneId: Types.ObjectId;
  position: { x: number; y: number; z: number };
  discovered: boolean;
  discoveredBy: Types.ObjectId | null;
  discoveredAtTick: number | null;
  physical: {
    radius: number;
    mass: number;
    composition: 'metallic' | 'carbonaceous' | 'siliceous' | 'icy';
  };
  resources: Array<{
    resourceType: string;
    abundance: number;
    totalDeposit: number;
    remaining: number;
    accessible: boolean;
  }>;
  depleted: boolean;
  orbit: {
    semiMajorAxis: number;
    eccentricity: number;
    inclination: number;
    longitudeOfAscendingNode: number;
    argumentOfPeriapsis: number;
    meanAnomalyAtEpoch: number;
    orbitalPeriod: number;
  };
  solarEnergyFactor: number;
  createdAt: Date;
  updatedAt: Date;
}

const AsteroidSchema = new Schema<IAsteroid>({
  name: { type: String, required: true, unique: true },
  beltZoneId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', required: true, index: true },
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    z: { type: Number, default: 0 },
  },
  discovered: { type: Boolean, default: false, index: true },
  discoveredBy: { type: Schema.Types.ObjectId, ref: 'Replicant', default: null },
  discoveredAtTick: { type: Number, default: null },
  physical: {
    radius: { type: Number, required: true },
    mass: { type: Number, required: true },
    composition: {
      type: String,
      enum: ['metallic', 'carbonaceous', 'siliceous', 'icy'],
      required: true,
    },
  },
  resources: [{
    resourceType: { type: String, required: true },
    abundance: { type: Number, min: 0, max: 1 },
    totalDeposit: { type: Number, required: true },
    remaining: { type: Number, required: true },
    accessible: { type: Boolean, default: true },
  }],
  depleted: { type: Boolean, default: false, index: true },
  orbit: {
    semiMajorAxis: { type: Number, required: true },
    eccentricity: { type: Number, required: true },
    inclination: { type: Number, required: true },
    longitudeOfAscendingNode: { type: Number, default: 0 },
    argumentOfPeriapsis: { type: Number, default: 0 },
    meanAnomalyAtEpoch: { type: Number, default: 0 },
    orbitalPeriod: { type: Number, required: true },
  },
  solarEnergyFactor: { type: Number, default: 1.0 },
}, { timestamps: true });

AsteroidSchema.index({ beltZoneId: 1, depleted: 1 });

export const Asteroid = model<IAsteroid>('Asteroid', AsteroidSchema);
