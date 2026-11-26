// db.js — connects to MongoDB Atlas with the official (native) "mongodb" driver.
// No Mongoose: we work with plain JavaScript objects and the driver's own methods
// (find, insertOne, updateOne...).

// MongoClient is the driver's class that manages the connection to the database server.
const { MongoClient } = require('mongodb');

// These start empty and are filled in once by connectDB().
// Keeping them here (outside the functions) means every file that requires db.js
// shares the SAME connection instead of opening a new one each time.
let client = null;
let db = null;

// Connects to MongoDB once and remembers the database object.
// It is "async" because connecting over the internet takes time;
// the caller waits for it with "await".
async function connectDB() {
  // Already connected? Just return the existing database.
  if (db) {
    return db;
  }

  // Fail early with a clear message if the connection string is missing from .env.
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set. Copy .env.example to .env and add your Atlas connection string.');
  }

  // Create the client with the connection string from .env and open the connection.
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  // Choose the database by name (e.g. "afterschool").
  // MongoDB creates it automatically the first time data is written to it.
  db = client.db(process.env.DB_NAME);

  // Set up the indexes the login system relies on (see createIndexes below).
  await createIndexes(db);

  return db;
}

// Creates the indexes for users, otps and sessions.
// An index is like the index at the back of a book: MongoDB can jump straight
// to a document instead of reading them all. Indexes can also add RULES.
// createIndex does nothing if the index already exists, so it's safe to run
// every time the server starts.
async function createIndexes(db) {
  // UNIQUE index on users.email: MongoDB refuses to insert a second user with an
  // email that is already used, even if two sign-ups arrive at the same moment.
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  // TTL ("time to live") indexes on expiresAt.
  // expireAfterSeconds: 0 means "delete the document as soon as the time in its
  // expiresAt field has passed". So old one-time codes and old login sessions
  // clean themselves up — no code of ours has to delete them.
  // (MongoDB checks about once a minute, so a document can live up to ~60 s longer.
  //  Our routes will still check expiresAt themselves to be exact.)
  await db.collection('otps').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

// Returns the database so routes can use it, e.g. getDB().collection('lessons').
// Throws if connectDB() has not run yet, so the mistake is obvious.
function getDB() {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
}

// Closes the connection. Used by scripts (like seed.js) so Node can exit when they finish.
async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

// Make the functions available to other files with require('./db').
module.exports = { connectDB, getDB, closeDB };
