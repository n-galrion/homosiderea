import { Schema, model, type Document, type Types } from 'mongoose';

export interface IFaction extends Document {
  _id: Types.ObjectId;
  name: string;
  type: 'governmental' | 'corporate' | 'military' | 'scientific' | 'independent';
  description: string;
  members: Types.ObjectId[];   // ref Settlement[]
  attitude: {
    general: number;               // toward replicants -1 to 1
    byReplicant: Record<string, number>;
  };
  resources: Record<string, number>; // faction-level resources
  policies: {
    tradeOpenness: number;         // 0-1
    militaryAggression: number;    // 0-1
    techSharing: number;           // 0-1
    replicantTolerance: number;    // 0-1
  };
  createdAt: Date;
  updatedAt: Date;
}

const FactionSchema = new Schema<IFaction>({
  name: { type: String, required: true, unique: true },
  type: {
    type: String,
    enum: ['governmental', 'corporate', 'military', 'scientific', 'independent'],
    required: true,
  },
  description: { type: String, default: '' },
  members: [{ type: Schema.Types.ObjectId, ref: 'Settlement' }],
  attitude: {
    general: { type: Number, default: 0.5 },
    byReplicant: { type: Schema.Types.Mixed, default: {} },
  },
  resources: { type: Schema.Types.Mixed, default: {} },
  policies: {
    tradeOpenness: { type: Number, default: 0.5 },
    militaryAggression: { type: Number, default: 0.2 },
    techSharing: { type: Number, default: 0.5 },
    replicantTolerance: { type: Number, default: 0.5 },
  },
}, { timestamps: true });

export const Faction = model<IFaction>('Faction', FactionSchema);
