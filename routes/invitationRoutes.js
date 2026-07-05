// backend/routes/invitationRoutes.js
const express = require('express');
const router = express.Router();
const invitationController = require('../controllers/invitationController');

// Route untuk memverifikasi token undangan (biasanya dipanggil saat user membuka link)
router.get('/verify', invitationController.verifyInvitation);

// Route untuk menerima/memproses registrasi dari undangan
router.post('/accept', invitationController.acceptInvitation);

// Route untuk mengirim undangan (jika diperlukan oleh admin)
// router.post('/send', invitationController.inviteUser); 

module.exports = router;