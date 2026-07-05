router.post('/upgrade', verifyToken, async (req, res) => {
  const { plan, isAnnual } = req.body;

  let endDate = new Date();

  if (plan === 'PRO') {
    if (isAnnual) {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }
  }

  await db.query(
    `UPDATE tbr_users 
     SET package_type=?, subscription_status='ACTIVE', subscription_ends_at=? 
     WHERE id=?`,
    [plan, endDate, req.user.id]
  );

  res.json({ message: "Upgrade berhasil" });
});