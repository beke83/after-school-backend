// utils/otp.js — one-time passwords (OTPs): the 6-digit codes we email to users.
// Each code is saved in the "otps" collection as:
//   { email, purpose, codeHash, attempts, expiresAt, lastSentAt }
// "purpose" says what the code is for, e.g. "verify" (confirm email) or "reset" (new password),
// so a code sent for one job can't be used for another.

const crypto = require('crypto');        // built into Node, no npm install needed
const { getDB } = require('../db');      // our helper that gives us the connected database

const CODE_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes, in milliseconds
const MAX_ATTEMPTS = 5;                  // wrong guesses allowed before the code is thrown away

// sha256(text) — returns the SHA-256 hash of some text, as hex.
// We store the HASH of the code, not the code itself, so anyone who could read
// the database still couldn't see (or use) a valid code.
// Why SHA-256 here, but slow scrypt for passwords? A code only lives 10 minutes and
// allows 5 guesses, so nobody has time to try all 1,000,000 codes. A password lives
// for years, so it needs a deliberately slow hash.
function sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

// createOtp(email, purpose) — makes a new code, saves its hash, returns the plain code
// (the plain code is only used to put in the email, never saved).
async function createOtp(email, purpose) {
    // crypto.randomInt is cryptographically random (unlike Math.random, which can be predicted).
    // 0 to 999999, then padStart adds zeros in front so 42 becomes "000042" (always 6 digits).
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

    const otps = getDB().collection('otps');

    // Only the newest code should work, so remove any older codes for this email + purpose.
    await otps.deleteMany({ email: email, purpose: purpose });

    const now = new Date();
    await otps.insertOne({
        email: email,
        purpose: purpose,
        codeHash: sha256(code),                                   // the hash, not the code
        attempts: 0,                                              // no wrong guesses yet
        expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),    // now + 10 minutes (TTL index deletes it after)
        lastSentAt: now                                           // used to stop resending too often
    });

    return code;
}

// checkOtp(email, purpose, code) — checks a code the user typed.
// Returns { ok: true } if it's right, or { ok: false, error: '...' } if not.
async function checkOtp(email, purpose, code) {
    const otps = getDB().collection('otps');
    const otp = await otps.findOne({ email: email, purpose: purpose });

    // No code saved for this email + purpose (never sent, already used, or deleted).
    if (!otp) {
        return { ok: false, error: 'Invalid or expired code' };
    }

    // Too old? The TTL index deletes expired codes, but only about once a minute,
    // so we check the time ourselves to be exact.
    if (otp.expiresAt < new Date()) {
        await otps.deleteOne({ _id: otp._id });
        return { ok: false, error: 'Invalid or expired code' };
    }

    // Too many wrong guesses already: throw the code away, the user must ask for a new one.
    // Without this limit someone could simply try all 1,000,000 codes.
    if (otp.attempts >= MAX_ATTEMPTS) {
        await otps.deleteOne({ _id: otp._id });
        return { ok: false, error: 'Too many attempts. Please request a new code.' };
    }

    // Hash what the user typed and compare it with the saved hash.
    // timingSafeEqual takes the same time whether the first or last character is wrong
    // (see utils/password.js). Both sha256 hex strings are always 64 characters long.
    const typed = Buffer.from(sha256(String(code)), 'hex');
    const saved = Buffer.from(otp.codeHash, 'hex');

    if (!crypto.timingSafeEqual(typed, saved)) {
        // Wrong code: add 1 to the attempts counter ($inc adds to a number).
        await otps.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
        return { ok: false, error: 'Invalid or expired code' };
    }

    // Right code: delete it so it can never be used a second time.
    await otps.deleteOne({ _id: otp._id });
    return { ok: true };
}

module.exports = { createOtp, checkOtp };   // let other files use both functions
