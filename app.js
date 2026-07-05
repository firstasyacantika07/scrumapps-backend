const nodemailer = require("nodemailer");
const notificationRoutes = require('./routes/notificationRoutes');

// Jika baris ini yang Anda gunakan:
app.use('/api/notifications', notificationRoutes);

async function sendEmail(to, subject, text) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "ujujic73892@gmail.com",
      pass: "nycrbkqltjypawiq",
    },
  });
  const sendmail = await transporter.sendMail({
    from: "no-reply@scrumapps.com",
    to: "uji@scrumapps.com",
    subject: "Sprint Reminder: Sprint akan berakhir dalam 1 hari",
    text: "Halo, ini adalah pengingat bahwa sprint Anda akan berakhir dalam 1 hari. Mohon segera selesaikan pekerjaan Anda.",
  });
  console.log("Email berhasil dikirim:", sendmail.response);
}   
 kirimEmail();