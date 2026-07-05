const snap = require('../services/midtrans');

router.post('/create-transaction', verifyToken, async (req, res) => {
  const { plan, isAnnual } = req.body;

  let price = 150000;
  if (isAnnual) price = 1500000;

  const parameter = {
    transaction_details: {
      order_id: `ORDER-${Date.now()}`,
      gross_amount: price
    },
    customer_details: {
      email: req.user.email
    }
  };

  const transaction = await snap.createTransaction(parameter);

  res.json({
    token: transaction.token,
    redirect_url: transaction.redirect_url
  });
});