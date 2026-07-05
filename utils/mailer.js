// Real email delivery for OTP codes, using Gmail SMTP via nodemailer.
//
// Setup (one time):
// 1. Use a Gmail account you control to send from (e.g. a project/support inbox).
// 2. Turn on 2-Step Verification on that Google account:
//    https://myaccount.google.com/security
// 3. Create an "App Password" for it:
//    https://myaccount.google.com/apppasswords
//    (Select app: "Mail", device: "Other" -> name it e.g. "edupay-backend")
//    Google gives you a 16-character password — copy it.
// 4. Add to your .env:
//      EMAIL_USER=youraccount@gmail.com
//      EMAIL_PASS=the16charapppassword   (NOT your normal Gmail password)
//
// Gmail's free SMTP has a sending limit (~500/day on a normal account), which
// is plenty for OTP emails on a small project. For production scale, swap this
// transport for a dedicated email API (SendGrid, Resend, Postmark, etc.) —
// the sendOtpEmail() function below is the only place that would need to change.

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error('EMAIL_USER / EMAIL_PASS not set in .env — cannot send real emails.');
        return null;
    }

    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        // Connection pooling: without this, nodemailer opens a brand new SMTP
        // connection (full TCP + TLS handshake + auth) for every single email,
        // even though we're reusing the same transporter object above. Pooling
        // keeps a small set of connections open and reuses them, which is what
        // actually makes repeated sends fast instead of each one paying the
        // full handshake cost.
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        // Fail fast instead of hanging if Gmail is slow to respond, so a stuck
        // connection doesn't make the OTP request appear to hang forever.
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000
    });

    // Verify the connection once at startup so misconfigured credentials show
    // up immediately in your logs instead of only failing on the first user's
    // OTP request.
    transporter.verify((err) => {
        if (err) {
            console.error('Email transporter verification failed:', err && err.message ? err.message : err);
        } else {
            console.log('Email transporter ready (Gmail SMTP, pooled).');
        }
    });

    return transporter;
}

async function sendOtpEmail(toEmail, otp) {
    const t = getTransporter();
    if (!t) {
        throw new Error('Email transporter is not configured. Set EMAIL_USER and EMAIL_PASS in .env.');
    }

    const start = Date.now();
    try {
        await t.sendMail({
            from: `"Source Carrier Institute" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: 'Your verification code',
            text: `Your verification code is ${otp}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
                    <h2 style="color: #1a1a1a;">Verification code</h2>
                    <p>Use the code below to continue. It expires in 10 minutes.</p>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #f2f2f2; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 20px 0;">
                        ${otp}
                    </div>
                    <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
                </div>
            `
        });
        console.log(`OTP email sent to ${toEmail} in ${Date.now() - start}ms`);
    } catch (err) {
        console.error(`OTP email to ${toEmail} failed after ${Date.now() - start}ms:`, err && err.message ? err.message : err);
        throw err;
    }
}

module.exports = { sendOtpEmail };