import { Schema, model, type Document, type Types } from 'mongoose';

export interface IMarket extends Document {
  _id: Types.ObjectId;
  settlementId: Types.ObjectId;
  bodyId: Types.ObjectId;
  name: string;
  // Current prices (credits per unit)
  prices: {
    buy: Record<string, number>;
    sell: Record<string, number>;
  };
  // Supply/demand drives price fluctuation
  supply: Record<string, number>;
  demand: Record<string, number>;
  // What this market trades in
  availableResources: string[];
  // Trade volume history
  lastTradeVolume: Record<string, number>;
  // Market restrictions
  restrictions: {
    embargoedReplicants: Types.ObjectId[];
    minAttitudeToTrade: number;
    taxRate: number;
  };
  lastUpdatedTick: number;
  createdAt: Date;
  updatedAt: Date;
}

const MarketSchema = new Schema<IMarket>({
  settlementId: { type: Schema.Types.ObjectId, ref: 'Settlement', required: true, index: true },
  bodyId: { type: Schema.Types.ObjectId, ref: 'CelestialBody', required: true },
  name: { type: String, required: true },
  prices: {
    buy: { type: Schema.Types.Mixed, default: {} },
    sell: { type: Schema.Types.Mixed, default: {} },
  },
  supply: { type: Schema.Types.Mixed, default: {} },
  demand: { type: Schema.Types.Mixed, default: {} },
  availableResources: [{ type: String }],
  lastTradeVolume: { type: Schema.Types.Mixed, default: {} },
  restrictions: {
    embargoedReplicants: [{ type: Schema.Types.ObjectId, ref: 'Replicant' }],
    minAttitudeToTrade: { type: Number, default: -0.5 },
    taxRate: { type: Number, default: 0.05 },
  },
  lastUpdatedTick: { type: Number, default: 0 },
}, { timestamps: true });

export const Market = model<IMarket>('Market', MarketSchema);
