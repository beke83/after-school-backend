// utils/password.js — safe password storage with Node's built-in "crypto" module.
// We NEVER save a password as plain text. If the database ever leaked,
// plain-text passwords could be read and used straight away (people reuse passwords).
//
// Instead we save a HASH: the result of a one-way function. You can turn a password
// into a hash, but you can't turn the hash back into the password.
// To check a login, we hash what the user typed and compare the two hashes.

const crypto = require('crypto');        // built into Node, no npm install needed
const { promisify } = require('util');   // built into Node too

// crypto.scrypt normally uses a callback. promisify turns it into a version
// that returns a Promise, so we can simply write: await scrypt(...)
const scrypt = promisify(crypto.scrypt);

// How long the hash is: 64 bytes (shown as 128 hex characters).
const KEY_LENGTH = 64;

// hashPassword(pw) — turns a password into "salt:hash" for saving in the database.
//
// SALT: 16 random bytes, different for every user (and every time we hash).
// Why? Without a salt, two users with the password "password123" would get the
// SAME hash, and attackers could use pre-built tables of common password hashes
// ("rainbow tables"). The random salt is mixed into the hash, so the same password
// gives a different hash for each user and those tables are useless.
// The salt isn't secret: we store it next to the hash, because we need it again to check a login.
//
// SCRYPT: a hashing function made for passwords. It is deliberately SLOW and uses a lot
// of memory, so an attacker trying millions of guesses per second is slowed right down.
// (A fast hash like SHA-256 is great for files, but too fast for passwords.)
async function hashPassword(pw) {
    const salt = crypto.randomBytes(16).toString('hex');       // 16 random bytes → 32 hex characters
    const hash = await scrypt(pw, salt, KEY_LENGTH);           // mix password + salt → 64-byte Buffer
    return salt + ':' + hash.toString('hex');                  // e.g. "a1b2...:9f8e..."
}

// verifyPassword(pw, stored) — checks a typed password against the saved "salt:hash".
// Returns true if it matches, false if not.
//
// TIMINGSAFEEQUAL: a normal comparison (=== or a loop) stops at the FIRST different
// character. So a guess that is "more right" takes a tiny bit longer to reject.
// By measuring those tiny time differences over many tries, an attacker could
// work out the hash bit by bit (a "timing attack").
// crypto.timingSafeEqual always compares EVERY byte, so it takes the same time
// whether the first byte is wrong or the last one — the timing gives nothing away.
async function verifyPassword(pw, stored) {
    // stored should look like "salt:hash" — if not, it can't match
    if (typeof stored !== 'string' || !stored.includes(':')) {
        return false;
    }

    const [salt, savedHashHex] = stored.split(':');            // split "salt:hash" into its two parts
    const savedHash = Buffer.from(savedHashHex, 'hex');        // hex text → bytes

    // Hash the typed password with the SAME salt. Same password + same salt = same hash.
    const typedHash = await scrypt(pw, salt, KEY_LENGTH);

    // timingSafeEqual throws an error if the two lengths are different,
    // so check that first (a different length can never be a match anyway).
    if (savedHash.length !== typedHash.length) {
        return false;
    }

    return crypto.timingSafeEqual(savedHash, typedHash);       // true only if every byte is equal
}

module.exports = { hashPassword, verifyPassword };             // let other files use both functions
