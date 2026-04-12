import { Schema, model, type Document, type Types } from 'mongoose';

export interface IPriceHistory extends Document {
  _id: Types.ObjectId;
  marketId: Types.ObjectId;
  settlementName: string;
  tick: number;
  prices: {
    buy: Record<string, number>;
    sell: Record<string, number>;
  };
}

const PriceHistorySchema = new Schema<IPriceHistory>({
  marketId: { type: Schema.Types.ObjectId, ref: 'Market', required: true, index: true },
  settlementName: { type: String, required: true },
  tick: { type: Number, required: true },
  prices: {
    buy: { type: Schema.Types.Mixed, default: {} },
    sell: { type: Schema.Types.Mixed, default: {} },
  },
}, { timestamps: true });

PriceHistorySchema.index({ marketId: 1, tick: -1 });

export const PriceHistory = model<IPriceHistory>('PriceHistory', PriceHistorySchema);
