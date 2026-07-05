const midtransClient = require('midtrans-client');
require('dotenv').config();

let snap;

// =========================
// INIT MIDTRANS SNAP
// =========================
const initMidtrans = () => {
  snap = new midtransClient.Snap({
    isProduction:
      process.env.MIDTRANS_IS_PRODUCTION === 'true',

    serverKey:
      process.env.MIDTRANS_SERVER_KEY || '',

    clientKey:
      process.env.MIDTRANS_CLIENT_KEY || '',
  });
};

// Jalankan init
initMidtrans();

// Export snap
module.exports = snap;