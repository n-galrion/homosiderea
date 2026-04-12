import { Schema, model, type Document, type Types } from 'mongoose';

export interface IResourceStore extends Document {
  _id: Types.ObjectId;
  ownerRef: {
    kind: 'Ship' | 'Structure' | 'CelestialBody' | 'Colony' | 'Settlement';
    item: Types.ObjectId;
  };
  // Raw materials
  metals: number;
  ice: number;
  silicates: number;
  rareEarths: number;
  helium3: number;
  organics: number;
  hydrogen: number;
  uranium: number;
  carbon: number;
  // Processed materials
  alloys: number;
  fuel: number;
  electronics: number;
  hullPlating: number;
  // Components
  engines: number;
  sensors: number;
  computers: number;
  weaponSystems: number;
  lifeSupportUnits: number;
  solarPanels: number;
  fusionCores: number;
  // Energy (ephemeral, regenerated each tick)
  energy: number;
}

const ResourceStoreSchema = new Schema<IResourceStore>({
  ownerRef: {
    kind: { type: String, enum: ['Ship', 'Structure', 'CelestialBody', 'Colony', 'Settlement'], required: true },
    item: { type: Schema.Types.ObjectId, refPath: 'ownerRef.kind', required: true },
  },
  // Raw
  metals: { type: Number, default: 0 },
  ice: { type: Number, default: 0 },
  silicates: { type: Number, default: 0 },
  rareEarths: { type: Number, default: 0 },
  helium3: { type: Number, default: 0 },
  organics: { type: Number, default: 0 },
  hydrogen: { type: Number, default: 0 },
  uranium: { type: Number, default: 0 },
  carbon: { type: Number, default: 0 },
  // Processed
  alloys: { type: Number, default: 0 },
  fuel: { type: Number, default: 0 },
  electronics: { type: Number, default: 0 },
  hullPlating: { type: Number, default: 0 },
  // Components
  engines: { type: Number, default: 0 },
  sensors: { type: Number, default: 0 },
  computers: { type: Number, default: 0 },
  weaponSystems: { type: Number, default: 0 },
  lifeSupportUnits: { type: Number, default: 0 },
  solarPanels: { type: Number, default: 0 },
  fusionCores: { type: Number, default: 0 },
  // Energy
  energy: { type: Number, default: 0 },
}, { timestamps: true });

ResourceStoreSchema.index({ 'ownerRef.kind': 1, 'ownerRef.item': 1 }, { unique: true });

export const ResourceStore = model<IResourceStore>('ResourceStore', ResourceStoreSchema);
