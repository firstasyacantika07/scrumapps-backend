require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// 🔧 FIX: Railway IPv6 ENETUNREACH workaround. 
// Memaksa seluruh resolusi DNS di Node.js menggunakan IPv4.
const originalLookup = dns.lookup;
dns.lookup = function lookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = { family: 4 };
    } else if (typeof options === 'number') {
        options = { family: 4 };
    } else if (options && typeof options === 'object') {
        options = { ...options, family: 4 };
    } else {
        options = { family: 4 };
    }
    return originalLookup(hostname, options, callback);
};

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const midtransClient = require('midtrans-client');
const path = require('path'); 

const app = express();

/* =========================================================
   MIDTRANS CONFIG
========================================================= */

const snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
});

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());

app.use(
    helmet({
        crossOriginResourcePolicy: false
    })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(morgan('dev'));

/* =========================================================
   ROUTES IMPORT
========================================================= */

const authRoutes = require('./routes/authRoutes');
const projectRoutes = require('./routes/projectRoutes'); 
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const superadminRoutes = require('./routes/superadminRoutes');
const billingRoutes = require('./routes/billingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
// 🗑️ FIX (#8 - paket & pembayaran tidak sinkron): subscriptionRoutes/subscriptionController
// dihapus dari sini. Ini adalah implementasi checkout & webhook Midtrans DUPLIKAT dari
// paymentController.js, memakai tabel `transactions` (bukan `tbr_payments`) dan sempat
// meng-update kolom `subscription_status` di tbr_tenants yang TIDAK ADA (kolom asli: `status`).
// Frontend (Billing.jsx) sudah dikonfirmasi 100% memakai /api/payment/create-transaction
// (paymentController.js), bukan controller ini -- jadi rute ini murni dead code yang
// berbahaya untuk dibiarkan aktif (risiko: webhook Midtrans salah diarahkan ke sini di
// masa depan akan membuat pembayaran sukses tapi paket tidak pernah ter-upgrade).
// File subscriptionController.js/subscriptionRoutes.js boleh dihapus permanen dari project.
const notificationRoutes = require('./routes/notificationRoutes');
const invitationRoutes = require('./routes/invitationRoutes');
const githubRoutes = require('./routes/githubRoutes');

const { startCronJobs } = require('./cron/cronService');
const paymentController = require('./controllers/paymentController');
const { verifyToken } = require('./middleware/auth');

/* =========================================================
   API ROUTES
========================================================= */

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/github', verifyToken, githubRoutes);
app.use('/api/dashboard', verifyToken, dashboardRoutes);
app.use('/api/billing', require('./routes/billingRoutes'));
app.use('/api/notifications', notificationRoutes);
app.use('/api/invitations', invitationRoutes);

app.post('/api/payment/create-transaction', verifyToken, paymentController.createPayment);
app.use('/api/payment', paymentRoutes);

/* =========================================================
   TEST ROUTE
========================================================= */

app.get('/', (req, res) => {
    return res.status(200).json({
        success: true,
        message: 'API ScrumApps berjalan 🚀',
        environment: process.env.MIDTRANS_IS_PRODUCTION === 'true' ? 'Production' : 'Sandbox',
        serverTime: new Date()
    });
});

app.get('/api/test-midtrans', async (req, res) => {
    try {
        const parameter = {
            transaction_details: {
                order_id: `ORDER-${Date.now()}`,
                gross_amount: 10000
            },
            credit_card: {
                secure: true
            },
            customer_details: {
                first_name: 'ScrumApps',
                email: 'test@scrumapps.com'
            }
        };

        const transaction = await snap.createTransaction(parameter);

        return res.status(200).json({
            success: true,
            message: 'Midtrans connected successfully',
            token: transaction.token,
            redirect_url: transaction.redirect_url
        });
    } catch (error) {
        console.error('Midtrans Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed connect to Midtrans',
            error: error.message
        });
    }
});

/* =========================================================
   SAFETY REDIRECT: /accept-invite
   (Jaga-jaga jika link undangan ter-klik lewat domain
   backend ini, misalnya karena FRONTEND_URL di .env belum
   benar. Route ini meneruskan ke FRONTEND_URL yang sebenarnya
   beserta query string token-nya, alih-alih jatuh ke 404.)
========================================================= */

app.get('/accept-invite', (req, res) => {
    const realFrontendUrl = process.env.REAL_FRONTEND_URL || process.env.FRONTEND_URL;

    if (!realFrontendUrl || realFrontendUrl.includes(req.hostname)) {
        return res.status(500).json({
            success: false,
            message: 'FRONTEND_URL belum dikonfigurasi dengan benar di .env (masih mengarah ke domain backend). Set REAL_FRONTEND_URL ke domain tempat aplikasi React berjalan.'
        });
    }

    const queryString = req.originalUrl.split('?')[1];
    const target = queryString
        ? `${realFrontendUrl}/accept-invite?${queryString}`
        : `${realFrontendUrl}/accept-invite`;

    return res.redirect(302, target);
});

/* =========================================================
   404 HANDLER
   (Backend ini hanya melayani API. Frontend React/Vite
   berjalan terpisah dari backend, jadi tidak ada static
   fallback ke folder dist/ di sini.)
========================================================= */

app.use((req, res) => {
    return res.status(404).json({
        success: false,
        message: 'Endpoint tidak ditemukan'
    });
});

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
    console.error(err.stack);
    return res.status(500).json({
        success: false,
        message: 'Internal Server Error',
        error: err.message
    });
});

/* =========================================================
   RUN SERVER
========================================================= */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    startCronJobs();
    console.log(`
==================================================
🚀 ScrumApps Backend Running
==================================================
🌐 URL         : http://localhost:${PORT}
🛡️ Environment : ${process.env.MIDTRANS_IS_PRODUCTION === 'true' ? 'PRODUCTION' : 'SANDBOX'}
💳 Midtrans    : Connected
==================================================
`);
});