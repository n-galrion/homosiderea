import { Schema, model, type Document, type Types } from 'mongoose';

export interface IShip extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  type: 'probe' | 'shuttle' | 'freighter' | 'miner' | 'warship' | 'station_module';
  status: 'docked' | 'in_transit' | 'orbiting' | 'destroyed';
  position: { x: number; y: number; z: number };
  orbitingBodyId: Types.ObjectId | null;
  orbitingAsteroidId: Types.ObjectId | null;
  dockedAtId: Types.ObjectId | null;
  navigation: {
    destinationBodyId: Types.ObjectId | null;
    destinationPos: { x: number; y: number; z: number } | null;
    departurePos: { x: number; y: number; z: number } | null;
    departureTick: number | null;
    arrivalTick: number | null;
    speed: number | null;
  };
  specs: {
    hullPoints: number;
    maxHullPoints: number;
    maxSpeed: number;
    cargoCapacity: number;
    fuelCapacity: number;
    sensorRange: number;
    miningRate: number;
    combatPower: number;
    manufacturingRate: number;
  };
  fuel: number;
  createdAtTick: number;
  createdAt: Date;
  updatedAt: Date;
}

const ShipSchema = new Schema<IShip>({
  name: { type: String, required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  type: {
    type: String,
    enum: ['probe', 'shuttle', 'freighter', 'miner', 'warship', 'station_module'],
    required: true,
  },
  status: {
    type: String,
    enum: ['docked', 'in_transit', 'orbiting', 'destroyed'],
    default: 'orbiting',
  },
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    z: { type: Number, default: 0 },
  },
  orbitingBodyId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', default: null },
  orbitingAsteroidId: { type: Schema.Types.ObjectId, ref: 'Asteroid', default: null },
  dockedAtId: { type: Schema.Types.ObjectId, ref: 'Structure', default: null },
  navigation: {
    destinationBodyId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', default: null },
    destinationPos: {
      type: { x: Number, y: Number, z: Number },
      default: null,
    },
    departurePos: {
      type: { x: Number, y: Number, z: Number },
      default: null,
    },
    departureTick: { type: Number, default: null },
    arrivalTick: { type: Number, default: null },
    speed: { type: Number, default: null },
  },
  specs: {
    hullPoints: { type: Number, default: 100 },
    maxHullPoints: { type: Number, default: 100 },
    maxSpeed: { type: Number, default: 0.001 },
    cargoCapacity: { type: Number, default: 100 },
    fuelCapacity: { type: Number, default: 50 },
    sensorRange: { type: Number, default: 0.1 },
    miningRate: { type: Number, default: 0 },
    combatPower: { type: Number, default: 0 },
    manufacturingRate: { type: Number, default: 0 },
  },
  fuel: { type: Number, default: 50 },
  createdAtTick: { type: Number, required: true },
}, { timestamps: true });

export const Ship = model<IShip>('Ship', ShipSchema);
