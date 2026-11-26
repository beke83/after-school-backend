// routes/auth.js — sign up, email verification, login, logout and password reset.
// server.js mounts this file with app.use('/auth', authRouter),
// so '/signup' in this file means '/auth/signup' in the browser.
//
// THE FULL SIGN-UP → VERIFY FLOW
// 1. POST /auth/signup { firstName, lastName, email, password }
//    - The server checks every field (never trust the browser).
//    - The password is hashed with a random salt (utils/password.js) — never saved as text.
//    - The user is saved with isVerified: false (they can't prove the email is theirs yet).
//    - A random 6-digit code is made (utils/otp.js). Only its HASH is saved, in "otps",
//      with a 10-minute expiry. The plain code is emailed to the user (utils/email.js).
// 2. The user opens the email and types the code into the website.
// 3. POST /auth/verify-email { email, code }
//    - checkOtp hashes the typed code and compares it with the saved hash
//      (max 5 wrong tries, must not be expired). On success the code is deleted.
//    - The user is updated to isVerified: true and can now log in.
// 4. Didn't get the email, or the code expired?
//    POST /auth/resend-otp { email, purpose } sends a fresh code (once per 60 seconds).
//
// LOGIN → LOGOUT
// 5. POST /auth/login { email, password } → checks the password, creates a session
//    and returns a random token. The front-end sends it as "Authorization: Bearer <token>".
// 6. GET /auth/me → who am I? (middleware/auth.js checks the token, see the comments there)
// 7. POST /auth/logout → deletes the session, so the token stops working.
//
// FORGOT PASSWORD
// 8. POST /auth/forgot-password { email } → emails a "reset" code (if the account exists).
// 9. POST /auth/reset-password { email, code, newPassword } → checks the code, saves the
//    new password hash and logs the user out everywhere.

const crypto = require('crypto');                           // built in: random session tokens
const express = require('express');                         // load Express
const router = express.Router();                            // a mini app that only holds routes
const { getDB } = require('../db');                         // the connected database
const { hashPassword, verifyPassword } = require('../utils/password'); // salt + scrypt hashing
const { requireAuth } = require('../middleware/auth');      // "must be logged in" check
const { createOtp, checkOtp } = require('../utils/otp');    // make / check a 6-digit code
const { sendEmail, codeEmailHtml } = require('../utils/email'); // send the code by email

// Patterns used to check the input
const NAME_PATTERN = /^[A-Za-z]+$/;               // letters only
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // something@something.something, no spaces
const CODE_PATTERN = /^[0-9]{6}$/;                // exactly 6 digits
const PURPOSES = ['verify', 'reset'];             // what a code can be for

// cleanEmail(email) — trims spaces and makes it lowercase, so "Jane@Mail.com "
// and "jane@mail.com" count as the same account. Returns '' if it isn't text.
function cleanEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// isStrongPassword(pw) — at least 8 characters, at least one letter AND one number.
// Used by sign-up and by reset-password, so both follow the same rule.
function isStrongPassword(pw) {
    return typeof pw === 'string' && pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}

// publicUser(user) — only the fields that are safe to send to the browser.
// passwordHash (and anything else) is left out on purpose.
function publicUser(user) {
    return {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role
    };
}

// 60-SECOND LIMIT for sending codes (used by resend-otp, forgot-password and login).
// Remembers when each email + purpose last asked for a code (resets if the server restarts).
// It's checked for EVERY email, even unknown ones, so the limit itself
// doesn't give away which emails have accounts.
const lastCodeRequest = new Map();
const RESEND_WAIT_MS = 60 * 1000;   // 60 seconds

// tooSoon(email, purpose) — true if a code for this email + purpose was asked for
// or sent less than 60 seconds ago. If not, it records "now" and returns false.
async function tooSoon(email, purpose) {
    const key = purpose + ':' + email;   // e.g. "verify:jane@mail.com"
    const now = Date.now();

    // check 1: did someone ask for a code for this email + purpose very recently?
    const lastAsked = lastCodeRequest.get(key);
    // check 2: was a code sent very recently (e.g. by sign-up)?
    // lastSentAt is saved by createOtp in the "otps" collection, so this
    // still works after the server restarts.
    const otp = await getDB().collection('otps').findOne({ email: email, purpose: purpose });

    if ((lastAsked && now - lastAsked < RESEND_WAIT_MS) ||
        (otp && now - otp.lastSentAt.getTime() < RESEND_WAIT_MS)) {
        return true;
    }
    lastCodeRequest.set(key, now);
    return false;
}

// sendCodeEmail(email, purpose, code) — emails the right message for the purpose.
async function sendCodeEmail(email, purpose, code) {
    if (purpose === 'verify') {
        await sendEmail(email, 'Your Classbar verification code',
            codeEmailHtml('Confirm your email', 'Enter this code on the Classbar website to finish creating your account.', code));
    } else {
        await sendEmail(email, 'Your Classbar password reset code',
            codeEmailHtml('Reset your password', 'Enter this code on the Classbar website to choose a new password.', code));
    }
}

// ---------------------------------------------------------------------------
// POST /auth/signup — create an account and email a verification code
// ---------------------------------------------------------------------------
router.post('/signup', async (req, res) => {
    const { firstName, lastName, password } = req.body || {};  // take the fields out of the body
    const email = cleanEmail((req.body || {}).email);         // lowercase + trimmed

    // Check every field. The first problem found is sent back as a 400 (Bad Request).
    if (typeof firstName !== 'string' || !NAME_PATTERN.test(firstName.trim())) {
        return res.status(400).json({ error: 'First name must contain letters only' });
    }
    if (typeof lastName !== 'string' || !NAME_PATTERN.test(lastName.trim())) {
        return res.status(400).json({ error: 'Last name must contain letters only' });
    }
    if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    // At least 8 characters, at least one letter AND at least one number
    if (!isStrongPassword(password)) {
        return res.status(400).json({ error: 'Password must be at least 8 characters with a letter and a number' });
    }

    try {
        const users = getDB().collection('users');

        // Is this email already used? 409 = Conflict.
        const existing = await users.findOne({ email: email });
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        // Save the new user. The password itself is never stored — only its salted hash.
        await users.insertOne({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email,
            passwordHash: await hashPassword(password),
            role: 'user',           // normal user (not admin)
            isVerified: false,      // becomes true after POST /auth/verify-email
            createdAt: new Date()
        });

        // Make a verification code and email it.
        // If the email fails, the account still exists, so we don't send a 500:
        // the user can simply ask for a new code with POST /auth/resend-otp.
        const code = await createOtp(email, 'verify');
        try {
            await sendCodeEmail(email, 'verify', code);
        } catch (emailErr) {
            console.error('Signup email failed:', emailErr.message);
        }

        res.status(201).json({ message: 'Account created. We sent a 6-digit code to your email.', email: email });
    } catch (err) {
        // 11000 = MongoDB's "duplicate key" error from the unique index on users.email.
        // It happens if two sign-ups with the same email arrive at the same moment.
        if (err.code === 11000) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /auth/verify-email — check the code and mark the account as verified
// ---------------------------------------------------------------------------
router.post('/verify-email', async (req, res) => {
    const email = cleanEmail((req.body || {}).email);
    const code = String((req.body || {}).code || '').trim();

    if (!EMAIL_PATTERN.test(email) || !CODE_PATTERN.test(code)) {
        return res.status(400).json({ error: 'Please enter your email and the 6-digit code' });
    }

    try {
        // checkOtp does all the code checks (exists, not expired, max 5 tries, hash matches)
        const result = await checkOtp(email, 'verify', code);
        if (!result.ok) {
            return res.status(400).json({ error: result.error });
        }

        // The code was right, so this person really owns the email.
        await getDB().collection('users').updateOne(
            { email: email },
            { $set: { isVerified: true } }
        );

        res.json({ message: 'Email verified. You can now log in.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /auth/resend-otp — send a fresh code (for "verify" or "reset")
// ---------------------------------------------------------------------------
// The reply is ALWAYS the same generic message, whether the email has an account or not.
// If we said "no account with this email", anyone could type in emails and find out
// who has an account here (called "account enumeration").

// The 60-second limit (tooSoon, at the top of this file) is applied to every email too.
router.post('/resend-otp', async (req, res) => {
    const email = cleanEmail((req.body || {}).email);
    const purpose = (req.body || {}).purpose;

    if (!EMAIL_PATTERN.test(email) || !PURPOSES.includes(purpose)) {
        return res.status(400).json({ error: 'Please send a valid email and purpose ("verify" or "reset")' });
    }

    try {
        if (await tooSoon(email, purpose)) {
            // 429 = Too Many Requests
            return res.status(429).json({ error: 'Please wait 60 seconds before asking for another code' });
        }

        // Only send if it makes sense for this account — but don't say which case happened.
        const user = await getDB().collection('users').findOne({ email: email });
        const shouldSend =
            (purpose === 'verify' && user && !user.isVerified) ||  // not verified yet
            (purpose === 'reset' && user);                         // any existing account

        if (shouldSend) {
            const code = await createOtp(email, purpose);
            await sendCodeEmail(email, purpose, code);
        }

        // Same answer in every case
        res.json({ message: 'If this email needs a code, we have sent a new one.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /auth/login — check email + password, start a session, return a token
// ---------------------------------------------------------------------------
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days, in milliseconds

router.post('/login', async (req, res) => {
    const email = cleanEmail((req.body || {}).email);
    const password = (req.body || {}).password;

    if (email === '' || typeof password !== 'string' || password === '') {
        return res.status(400).json({ error: 'Please enter your email and password' });
    }

    try {
        const db = getDB();
        const user = await db.collection('users').findOne({ email: email });

        // Wrong email OR wrong password → the SAME message on purpose.
        // Saying "no account with this email" would tell people which emails are registered.
        if (!user || !(await verifyPassword(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Incorrect email or password' });
        }

        // Right password, but the email was never confirmed: send a fresh code
        // (unless one was sent in the last 60 seconds) and tell the front-end
        // to show the "enter your code" screen. 403 = Forbidden (not allowed yet).
        if (!user.isVerified) {
            if (!(await tooSoon(email, 'verify'))) {
                const code = await createOtp(email, 'verify');
                await sendCodeEmail(email, 'verify', code);
            }
            return res.status(403).json({
                error: 'Please verify your email first. We sent you a code.',
                needsVerification: true,
                email: email
            });
        }

        // Create the session. randomBytes(32) = 32 random bytes = 64 hex characters,
        // far too many possibilities for anyone to guess.
        const token = crypto.randomBytes(32).toString('hex');
        await db.collection('sessions').insertOne({
            token: token,
            userId: user._id,                                     // which user this session belongs to
            expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) // TTL index deletes it after 7 days
        });

        // Send the token and the safe user fields (never passwordHash).
        res.json({ token: token, user: publicUser(user) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /auth/me — the logged-in user (requireAuth checks the token first)
// ---------------------------------------------------------------------------
// requireAuth runs BEFORE the route. If the token is missing or invalid it sends 401
// and the route never runs. If it's valid, it puts the user in req.user.
router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
});

// ---------------------------------------------------------------------------
// POST /auth/logout — delete this session so the token stops working
// ---------------------------------------------------------------------------
router.post('/logout', requireAuth, async (req, res) => {
    try {
        // req.token was set by requireAuth. Only THIS session is deleted,
        // so the user stays logged in on their other devices.
        await getDB().collection('sessions').deleteOne({ token: req.token });
        res.json({ message: 'Logged out' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /auth/forgot-password — email a "reset" code (if the account exists)
// ---------------------------------------------------------------------------
// Always the same answer, so nobody can use this to find out which emails have accounts.
router.post('/forgot-password', async (req, res) => {
    const email = cleanEmail((req.body || {}).email);

    if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    try {
        // Same 60-second limit as resend-otp, checked for every email.
        if (await tooSoon(email, 'reset')) {
            return res.status(429).json({ error: 'Please wait 60 seconds before asking for another code' });
        }

        const user = await getDB().collection('users').findOne({ email: email });
        if (user) {
            const code = await createOtp(email, 'reset');
            await sendCodeEmail(email, 'reset', code);
        }

        res.json({ message: 'If an account exists for this email, we have sent a reset code.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /auth/reset-password — check the reset code and save a new password
// ---------------------------------------------------------------------------
router.post('/reset-password', async (req, res) => {
    const email = cleanEmail((req.body || {}).email);
    const code = String((req.body || {}).code || '').trim();
    const newPassword = (req.body || {}).newPassword;

    if (!EMAIL_PATTERN.test(email) || !CODE_PATTERN.test(code)) {
        return res.status(400).json({ error: 'Please enter your email and the 6-digit code' });
    }
    if (!isStrongPassword(newPassword)) {
        return res.status(400).json({ error: 'Password must be at least 8 characters with a letter and a number' });
    }

    try {
        // The code proves the person can read this email inbox.
        const result = await checkOtp(email, 'reset', code);
        if (!result.ok) {
            return res.status(400).json({ error: result.error });
        }

        const db = getDB();
        const user = await db.collection('users').findOne({ email: email });
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired code' });
        }

        // Save the new password (salted hash, as always).
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { passwordHash: await hashPassword(newPassword) } }
        );

        // Log the user out EVERYWHERE: delete all their sessions.
        // If someone else knew the old password and was logged in, they're kicked out now.
        await db.collection('sessions').deleteMany({ userId: user._id });

        res.json({ message: 'Password changed. Please log in with your new password.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;   // let server.js use this router
