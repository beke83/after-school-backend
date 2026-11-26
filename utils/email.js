// utils/email.js — sends emails (e.g. one-time login codes) through Brevo's HTTP API.
//
// Why not normal SMTP (e.g. with the nodemailer package)?
// SMTP is the classic way to send email, but it uses special network ports (25, 465, 587).
// Render's FREE tier blocks outgoing traffic on those SMTP ports, to stop free servers
// being used to send spam. So an SMTP email would simply never leave the server.
// Brevo also offers an HTTP API: we send the email as a normal HTTPS request (port 443),
// exactly like the front-end calls our API with fetch(). Render allows that.
// fetch() is built into Node 18+, so no npm package is needed.

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';  // Brevo's "send an email" address

// sendEmail(to, subject, html) — sends one email.
//   to:      the receiver's email address, e.g. "jane@example.com"
//   subject: the subject line
//   html:    the body of the email, written as HTML
async function sendEmail(to, subject, html) {
    // Local development: no Brevo key in .env → don't send anything,
    // just print the email in the terminal so I can still see (and use) it.
    if (!process.env.BREVO_API_KEY) {
        console.log('--- EMAIL (not sent: BREVO_API_KEY is not set) ---');
        console.log('To:      ' + to);
        console.log('Subject: ' + subject);
        console.log(html);
        console.log('--------------------------------------------------');
        return;
    }

    // Send a POST request to Brevo with the email as JSON.
    const response = await fetch(BREVO_URL, {
        method: 'POST',
        headers: {
            'api-key': process.env.BREVO_API_KEY,  // proves to Brevo that it's my account
            'Content-Type': 'application/json',    // the body we send is JSON
            'Accept': 'application/json'           // we want JSON back
        },
        body: JSON.stringify({
            sender: {                               // who the email is from (from .env)
                email: process.env.EMAIL_FROM,
                name: process.env.EMAIL_FROM_NAME
            },
            to: [{ email: to }],                    // Brevo expects a list of receivers
            subject: subject,
            htmlContent: html
        })
    });

    // response.ok is true for status 200-299. Anything else means Brevo refused
    // (wrong key, sender not verified...), so throw an error with Brevo's reason.
    if (!response.ok) {
        const reason = await response.text();
        throw new Error('Email could not be sent (Brevo ' + response.status + '): ' + reason);
    }
}

// codeEmailHtml(heading, message, code) — builds a simple branded email holding a 6-digit code.
// Emails can't use our CSS file, and many email apps ignore <style> tags, so every
// style is written "inline" on the element itself. The three coloured bars are the
// Classbar logo (red, yellow, green), same as on the website.
function codeEmailHtml(heading, message, code) {
    return `
    <div style="background:#F7F7F4;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#111111;">
      <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E0;border-radius:12px;padding:32px;">
        <div style="margin-bottom:24px;">
          <span style="display:inline-block;width:7px;height:12px;background:#EF5350;border-radius:4px;"></span>
          <span style="display:inline-block;width:7px;height:19px;background:#F9D74A;border-radius:4px;"></span>
          <span style="display:inline-block;width:7px;height:26px;background:#4ADE80;border-radius:4px;"></span>
          <span style="font-size:20px;font-weight:800;margin-left:8px;">Classbar</span>
        </div>
        <h1 style="font-size:22px;margin:0 0 12px;">${heading}</h1>
        <p style="font-size:15px;line-height:1.5;color:#3F3F46;margin:0 0 24px;">${message}</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;background:#FDF0B8;border-radius:8px;padding:16px;margin-bottom:24px;">${code}</div>
        <p style="font-size:13px;color:#71717A;margin:0;">This code expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
      </div>
    </div>`;
}

module.exports = { sendEmail, codeEmailHtml };  // let other files use both functions
