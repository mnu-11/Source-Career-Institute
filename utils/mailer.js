// Sends transactional emails via Brevo (https://www.brevo.com), formerly Sendinblue.
// Uses Brevo's REST API directly with the built-in fetch (Node 18+), so no extra
// SDK dependency is needed.
//
// Required .env vars:
//   BREVO_API_KEY    - from Brevo dashboard -> Settings -> SMTP & API -> API Keys
//   EMAIL_FROM       - the "from" address, e.g. "noreply@yourdomain.com"
//                       (must be a verified sender in Brevo -> Senders, Domains & Dedicated IPs)
//   EMAIL_FROM_NAME  - (optional) display name, e.g. "Source Career Institute"

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

if (!process.env.BREVO_API_KEY) {
    console.warn('BREVO_API_KEY is not set. Emails will fail to send until it is added to .env.');
}
if (!process.env.EMAIL_FROM) {
    console.warn('EMAIL_FROM is not set. Add a verified sender email to .env.');
}

async function sendOtpEmail(toEmail, otp) {
    const payload = {
        sender: {
            email: process.env.EMAIL_FROM,
            name: process.env.EMAIL_FROM_NAME || 'Source Career Institute'
        },
        to: [{ email: toEmail }],
        subject: 'Your verification code',
        htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
                <h2 style="color: #1a1a1a;">Verification code</h2>
                <p>Use the code below to continue. It expires in 10 minutes.</p>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #f2f2f2; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 20px 0;">
                    ${otp}
                </div>
                <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
            </div>
        `,
        textContent: `Your verification code is ${otp}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`
    };

    const start = Date.now();
    let response;
    try {
        response = await fetch(BREVO_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'api-key': process.env.BREVO_API_KEY
            },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error(`OTP email to ${toEmail} failed (network error) after ${Date.now() - start}ms:`, err && err.message ? err.message : err);
        throw err;
    }

    if (!response.ok) {
        let details;
        try {
            details = await response.json();
        } catch {
            details = await response.text();
        }
        console.error(`OTP email to ${toEmail} failed after ${Date.now() - start}ms:`, details);
        throw new Error(`Brevo failed to send email (${response.status}): ${JSON.stringify(details)}`);
    }

    const data = await response.json();
    console.log(`OTP email sent to ${toEmail} in ${Date.now() - start}ms`);
    return data;
}

module.exports = { sendOtpEmail };