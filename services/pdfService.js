const generatePDF = (req, res) => {
  try {
    const watermark = req.planLimits.pdfWatermark;

    if (watermark === true) {
      // TODO: tambahkan watermark "ScrumApps Free"
    } else if (watermark === 'custom') {
      // TODO: gunakan logo perusahaan
    } else {
      // tanpa watermark
    }

    // PENTING: sebelumnya fungsi ini tidak pernah mengirim response,
    // sehingga request dari client akan hang tanpa batas waktu (timeout).
    // Sementara logika pembuatan PDF aktual (watermark, layout, dsb.)
    // belum diimplementasikan di sini, kirim respons yang jelas
    // agar tidak membuat request menggantung.
    return res.status(501).json({
      success: false,
      message: 'PDF generation belum diimplementasikan di pdfService.js'
    });
  } catch (error) {
    console.error('Gagal generate PDF:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat PDF'
    });
  }
};

// PENTING: sebelumnya tidak ada module.exports sama sekali,
// sehingga file ini tidak bisa di-require/dipakai oleh route lain (akan undefined).
module.exports = { generatePDF };