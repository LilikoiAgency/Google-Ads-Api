// src/lib/mongoose.js
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;

if (!global._mongoClientPromise) {
  const client = new MongoClient(uri);
  global._mongoClientPromise = client.connect();
}

const clientPromise = global._mongoClientPromise;

export default async function dbConnect() {
  return clientPromise;
}
