import { Schema, model, type Document, type Types } from 'mongoose';

export interface ISalvage extends Document {
  _id: Types.ObjectId;
  name: string;
  type: 'wreckage' | 'black_box' | 'cargo_pod' | 'tech_fragment' | 'encrypted_data';
  position: { x: number; y: number; z: number };
  // What ship/entity produced this
  sourceShipName: string;
  sourceOwnerType: 'player' | 'npc' | 'pirate' | 'unknown';
  // Contents
  resources: Record<string, number>;
  // Black box / data content (narrative, generated or stored)
  dataContent: {
    flightLog: string | null;
    lastTransmission: string | null;
    encryptedData: string | null;
    techHints: string[];
    sensorReadings: string | null;
  } | null;
  // Tech fragment details
  techFragment: {
    domain: string | null;
    description: string | null;
    researchBonus: number;
  } | null;
  // State
  discovered: boolean;
  discoveredBy: Types.ObjectId | null;
  collected: boolean;
  collectedBy: Types.ObjectId | null;
  collectedAtTick: number | null;
  createdAtTick: number;
  expiresAtTick: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const SalvageSchema = new Schema<ISalvage>({
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ['wreckage', 'black_box', 'cargo_pod', 'tech_fragment', 'encrypted_data'],
    required: true,
  },
  position: {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    z: { type: Number, required: true },
  },
  sourceShipName: { type: String, required: true },
  sourceOwnerType: {
    type: String,
    enum: ['player', 'npc', 'pirate', 'unknown'],
    default: 'unknown',
  },
  resources: { type: Schema.Types.Mixed, default: {} },
  dataContent: {
    type: {
      flightLog: { type: String, default: null },
      lastTransmission: { type: String, default: null },
      encryptedData: { type: String, default: null },
      techHints: [{ type: String }],
      sensorReadings: { type: String, default: null },
    },
    default: null,
  },
  techFragment: {
    type: {
      domain: { type: String, default: null },
      description: { type: String, default: null },
      researchBonus: { type: Number, default: 0 },
    },
    default: null,
  },
  discovered: { type: Boolean, default: false },
  discoveredBy: { type: Schema.Types.ObjectId, ref: 'Replicant', default: null },
  collected: { type: Boolean, default: false },
  collectedBy: { type: Schema.Types.ObjectId, ref: 'Replicant', default: null },
  collectedAtTick: { type: Number, default: null },
  createdAtTick: { type: Number, required: true },
  expiresAtTick: { type: Number, default: null },
}, { timestamps: true });

SalvageSchema.index({ discovered: 1, collected: 1 });
SalvageSchema.index({ position: '2d' });

export const Salvage = model<ISalvage>('Salvage', SalvageSchema);
