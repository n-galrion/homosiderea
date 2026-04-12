import { Schema, model, type Document, type Types } from 'mongoose';

export interface ISettlement extends Document {
  _id: Types.ObjectId;
  name: string;
  bodyId: Types.ObjectId;
  siteId: Types.ObjectId | null;
  type: 'city' | 'outpost' | 'orbital_station' | 'colony';
  nation: string;
  population: number;
  // Leadership & governance
  leadership: {
    leaderName: string;
    leaderTitle: string;       // "Mayor", "Governor", "Director", "Commander"
    governmentType: string;    // "democracy", "technocracy", "corporate", "military", "collective"
  };
  // Cultural identity
  culture: {
    temperament: string;       // "welcoming", "cautious", "mercantile", "isolationist", "militaristic", "scientific"
    description: string;       // 1-2 sentence character description
    priorities: string[];      // What they care about: ["trade", "defense", "research", "expansion"]
  };
  // Faction allegiance
  factionId: Types.ObjectId | null;
  // Economic stats
  economy: {
    gdp: number;
    techLevel: number;
    industrialCapacity: number;
    spaceportLevel: number;
  };
  // What they produce and consume (drives market prices)
  production: Record<string, number>;
  consumption: Record<string, number>;
  // Attitude toward replicants (-1.0 hostile to 1.0 friendly)
  attitude: {
    general: number;
    byReplicant: Record<string, number>;
  };
  // Defenses (relevant if someone decides to attack)
  defenses: {
    militaryStrength: number;
    orbitalDefenses: number;
    shieldLevel: number;
  };
  // State
  status: 'thriving' | 'stable' | 'struggling' | 'damaged' | 'destroyed';
  position: { lat: number; lon: number };
  createdAt: Date;
  updatedAt: Date;
}

const SettlementSchema = new Schema<ISettlement>({
  name: { type: String, required: true },
  bodyId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', required: true, index: true },
  siteId: { type: Schema.Types.ObjectId, ref: 'LandingSite', default: null },
  type: {
    type: String,
    enum: ['city', 'outpost', 'orbital_station', 'colony'],
    required: true,
  },
  nation: { type: String, required: true },
  population: { type: Number, required: true },
  leadership: {
    leaderName: { type: String, default: 'Unknown' },
    leaderTitle: { type: String, default: 'Director' },
    governmentType: { type: String, default: 'democracy' },
  },
  culture: {
    temperament: { type: String, default: 'cautious' },
    description: { type: String, default: '' },
    priorities: { type: [String], default: [] },
  },
  factionId: { type: Schema.Types.ObjectId, ref: 'Faction', default: null },
  economy: {
    gdp: { type: Number, default: 100 },
    techLevel: { type: Number, default: 5 },
    industrialCapacity: { type: Number, default: 100 },
    spaceportLevel: { type: Number, default: 0 },
  },
  production: { type: Schema.Types.Mixed, default: {} },
  consumption: { type: Schema.Types.Mixed, default: {} },
  attitude: {
    general: { type: Number, default: 0.5 },
    byReplicant: { type: Schema.Types.Mixed, default: {} },
  },
  defenses: {
    militaryStrength: { type: Number, default: 1 },
    orbitalDefenses: { type: Number, default: 0 },
    shieldLevel: { type: Number, default: 0 },
  },
  status: {
    type: String,
    enum: ['thriving', 'stable', 'struggling', 'damaged', 'destroyed'],
    default: 'stable',
  },
  position: {
    lat: { type: Number, default: 0 },
    lon: { type: Number, default: 0 },
  },
}, { timestamps: true });

SettlementSchema.index({ bodyId: 1, type: 1 });

export const Settlement = model<ISettlement>('Settlement', SettlementSchema);
