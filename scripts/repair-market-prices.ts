import mongoose from 'mongoose';
import 'dotenv/config';
import { Market } from '../src/db/models/index.js';
import { settlements } from '../src/db/seeds/settlements.js';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(uri);

  // Canonical prices keyed by "<Name> Exchange" (the market name used in the seed).
  const canonical = new Map<string, { buy: Record<string, number>; sell: Record<string, number> }>();
  for (const s of settlements) {
    if (s.market) canonical.set(`${s.name} Exchange`, { buy: s.market.buy, sell: s.market.sell });
  }

  const markets = await Market.find();
  let repaired = 0;
  for (const market of markets) {
    const base = canonical.get(market.name);
    if (!base) {
      console.warn(`No canonical base for market "${market.name}" — skipping.`);
      continue;
    }
    const beforeBuy = JSON.stringify(market.prices.buy);
    market.basePrices = { buy: { ...base.buy }, sell: { ...base.sell } };
    market.prices = { buy: { ...base.buy }, sell: { ...base.sell } };
    market.markModified('prices');
    market.markModified('basePrices');
    await market.save();
    repaired++;
    console.log(`Repaired ${market.name}: buy ${beforeBuy} -> ${JSON.stringify(market.prices.buy)}`);
  }

  console.log(`Done. Repaired ${repaired}/${markets.length} markets.`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
