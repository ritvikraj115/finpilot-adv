// tools/create_tx_index.js
require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = mongoose.connection.db;
  try {
    console.log('Creating unique index on transactions.transaction_id...');
    await db.collection('transactions').createIndex({ transaction_id: 1 }, { unique: true, background: true, sparse: true });
    console.log('Index created (or already exists).');
  } catch (err) {
    console.error('Index creation failed:', err.message || err);
  } finally {
    await mongoose.disconnect();
  }
}
run().catch(err => { console.error(err); process.exit(1); });
