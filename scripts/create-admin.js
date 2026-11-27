// scripts/create-admin.js — creates the admin account (or updates it if it already exists).
// Run it with "npm run create-admin" from the backend folder.
// It reads ADMIN_EMAIL and ADMIN_PASSWORD from .env, so the admin password is
// never written in the code or committed to GitHub.
// Run it again after changing ADMIN_PASSWORD in .env to change the admin's password.

// path builds file paths that work on Windows, Mac and Linux.
const path = require('path');

// Load .env from the backend folder (one level up from scripts/).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectDB, closeDB } = require('../db');            // same connection helper as the server
const { hashPassword } = require('../utils/password');      // salt + scrypt hashing

async function createAdmin() {
  // Same email clean-up as sign-up: no spaces, lowercase.
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  // Stop early with a clear message if .env is missing the settings.
  if (!email || !password) {
    console.error('Please set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
    process.exitCode = 1;
    return;
  }
  // Same password rule as sign-up: at least 8 characters, a letter and a number.
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    console.error('ADMIN_PASSWORD must be at least 8 characters with a letter and a number.');
    process.exitCode = 1;
    return;
  }

  try {
    const db = await connectDB();

    // "Upsert" = UPdate if it exists, inSERT if it doesn't, in one command.
    // - $set is applied in BOTH cases: make sure the account is an admin,
    //   verified, and has the password from .env.
    // - $setOnInsert is applied ONLY when a new user is created
    //   (so an existing user's name and createdAt aren't overwritten).
    const result = await db.collection('users').updateOne(
      { email: email },
      {
        $set: {
          role: 'admin',
          isVerified: true,
          passwordHash: await hashPassword(password)
        },
        $setOnInsert: {
          email: email,
          firstName: 'Admin',
          lastName: 'User',
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    if (result.upsertedCount === 1) {
      console.log('Created admin account: ' + email);
    } else {
      console.log('Updated existing account to admin: ' + email);
    }
  } catch (err) {
    console.error('Could not create admin:', err.message);
    process.exitCode = 1;   // tells the terminal (and npm) that the script failed
  } finally {
    await closeDB();        // always close the connection, otherwise Node keeps running
  }
}

createAdmin();
