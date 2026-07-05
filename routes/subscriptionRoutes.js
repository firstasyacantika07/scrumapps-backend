const express = require('express');
const router = express.Router();

const subscriptionController = require('../controllers/subscriptionController');
const { verifyToken } = require('../middleware/auth');

// POST checkout
router.post('/checkout', verifyToken, subscriptionController.createCheckout);

// webhook (no auth)
router.post('/webhook', subscriptionController.handleMidtransWebhook);

// GET subscription user
router.get('/me', verifyToken, async (req, res) => {
  try {
    res.json({
      success: true,
      subscription: {
        package_type: req.user.package_type,
        subscription_status: req.user.subscription_status,
        trial_ends_at: req.user.trial_ends_at,
        subscription_ends_at: req.user.subscription_ends_at
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;