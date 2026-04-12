import { Schema, model, type Document, type Types } from 'mongoose';

export interface ICelestialBody extends Document {
  _id: Types.ObjectId;
  name: string;
  type: 'star' | 'planet' | 'dwarf_planet' | 'moon' | 'asteroid' | 'comet' | 'belt_zone';
  parentId: Types.ObjectId | null;
  orbit: {
    semiMajorAxis: number;
    eccentricity: number;
    inclination: number;
    longitudeOfAscendingNode: number;
    argumentOfPeriapsis: number;
    meanAnomalyAtEpoch: number;
    orbitalPeriod: number;
  } | null;
  physical: {
    mass: number;
    radius: number;
    gravity: number;
    hasAtmosphere: boolean;
  };
  resources: Array<{
    resourceType: string;
    abundance: number;
    totalDeposit: number;
    remaining: number;
    accessible: boolean;
  }>;
  position: { x: number; y: number; z: number };
  solarEnergyFactor: number;
  beltConfig: {
    maxAsteroids: number;
    generatedCount: number;
    density: number;
    compositionWeights: {
      metallic: number;
      carbonaceous: number;
      siliceous: number;
      icy: number;
    };
  } | null;
  surfaceConfig: {
    maxLandingSites: number;
    generatedCount: number;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const CelestialBodySchema = new Schema<ICelestialBody>({
  name: { type: String, required: true, unique: true },
  type: {
    type: String,
    enum: ['star', 'planet', 'dwarf_planet', 'moon', 'asteroid', 'comet', 'belt_zone'],
    required: true,
  },
  parentId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', default: null },
  orbit: {
    type: {
      semiMajorAxis: { type: Number },
      eccentricity: { type: Number },
      inclination: { type: Number },
      longitudeOfAscendingNode: { type: Number },
      argumentOfPeriapsis: { type: Number },
      meanAnomalyAtEpoch: { type: Number },
      orbitalPeriod: { type: Number },
    },
    default: null,
  },
  physical: {
    mass: { type: Number, default: 0 },
    radius: { type: Number, default: 0 },
    gravity: { type: Number, default: 0 },
    hasAtmosphere: { type: Boolean, default: false },
  },
  resources: [{
    resourceType: { type: String, required: true },
    abundance: { type: Number, min: 0, max: 1 },
    totalDeposit: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    accessible: { type: Boolean, default: true },
  }],
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    z: { type: Number, default: 0 },
  },
  solarEnergyFactor: { type: Number, default: 1.0 },
  beltConfig: {
    type: {
      maxAsteroids: { type: Number, default: 200 },
      generatedCount: { type: Number, default: 0 },
      density: { type: Number, default: 3 },
      compositionWeights: {
        metallic: { type: Number, default: 0.25 },
        carbonaceous: { type: Number, default: 0.25 },
        siliceous: { type: Number, default: 0.25 },
        icy: { type: Number, default: 0.25 },
      },
    },
    default: null,
  },
  surfaceConfig: {
    type: {
      maxLandingSites: { type: Number, default: 10 },
      generatedCount: { type: Number, default: 0 },
    },
    default: null,
  },
}, { timestamps: true });

export const CelestialBody = model<ICelestialBody>('CelestialBody', CelestialBodySchema);
