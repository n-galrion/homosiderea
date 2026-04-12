import mongoose from 'mongoose';
import { config } from '../config.js';

export async function connectDB(): Promise<typeof mongoose> {
  const conn = await mongoose.connect(config.mongodb.uri);
  return conn;
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
