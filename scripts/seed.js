// scripts/seed.js — fills the database with the 12 starting lessons.
// Run it with "npm run seed" (or "node scripts/seed.js") from the backend folder.
// WARNING: it deletes all existing lessons first, so every run starts fresh.

// path builds file paths that work on Windows, Mac and Linux.
const path = require('path');

// Load .env from the backend folder (one level up from scripts/),
// so the script works no matter which folder it is run from.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Reuse the same connection helper as the server.
const { connectDB, closeDB } = require('../db');

// The 12 lessons — same topics, locations and prices as the front-end dummy data.
// - space: every lesson starts with 5 free places.
// - icon:  Font Awesome class, shown on the lesson card.
// - image: file name of the lesson picture in public/images/.
//
// _id vs id:
// The old front-end dummy data had a number "id" (1 to 12) that I typed by hand.
// Here there is NO id field. When a document is inserted, MongoDB adds its own
// "_id" automatically: an ObjectId, a unique 24-character hex value such as
// "6730c9f2a1b2c3d4e5f60718". It is unique across the whole collection and is
// what MongoDB uses to find a document. The front-end will switch to using
// lesson._id (e.g. lesson.html?id=6730c9f2...) instead of the old number id.
const lessons = [
  { topic: 'Maths',    location: 'Hendon',        price: 100, space: 5, icon: 'fa-solid fa-calculator',      image: 'maths.png' },
  { topic: 'English',  location: 'Colindale',     price: 90,  space: 5, icon: 'fa-solid fa-book-open',       image: 'english.png' },
  { topic: 'Music',    location: 'Brent Cross',   price: 120, space: 5, icon: 'fa-solid fa-music',           image: 'music.png' },
  { topic: 'Art',      location: 'Golders Green', price: 80,  space: 5, icon: 'fa-solid fa-palette',         image: 'art.png' },
  { topic: 'Coding',   location: 'Mill Hill',     price: 110, space: 5, icon: 'fa-solid fa-code',            image: 'coding.png' },
  { topic: 'Science',  location: 'Edgware',       price: 95,  space: 5, icon: 'fa-solid fa-flask',           image: 'science.png' },
  { topic: 'Chess',    location: 'Hendon',        price: 60,  space: 5, icon: 'fa-solid fa-chess-knight',    image: 'chess.png' },
  { topic: 'Football', location: 'Colindale',     price: 70,  space: 5, icon: 'fa-solid fa-futbol',          image: 'football.png' },
  { topic: 'Drama',    location: 'Brent Cross',   price: 85,  space: 5, icon: 'fa-solid fa-masks-theater',   image: 'drama.png' },
  { topic: 'Swimming', location: 'Golders Green', price: 115, space: 5, icon: 'fa-solid fa-person-swimming', image: 'swimming.png' },
  { topic: 'French',   location: 'Mill Hill',     price: 90,  space: 5, icon: 'fa-solid fa-language',        image: 'french.png' },
  { topic: 'Robotics', location: 'Edgware',       price: 125, space: 5, icon: 'fa-solid fa-robot',           image: 'robotics.png' }
];

async function seed() {
  try {
    const db = await connectDB();
    console.log('Connected to MongoDB');

    // 1. Clear the lessons collection: an empty filter {} matches every document.
    const deleted = await db.collection('lessons').deleteMany({});
    console.log('Deleted ' + deleted.deletedCount + ' old lessons');

    // 2. Insert the 12 lessons in one go. MongoDB adds an _id to each one.
    const inserted = await db.collection('lessons').insertMany(lessons);
    console.log('Inserted ' + inserted.insertedCount + ' lessons');

    // 3. Make sure an "orders" collection exists (empty for now).
    //    listCollections finds collections by name; if none is found, create it.
    //    (Orders are never deleted here — only lessons are reset.)
    const found = await db.listCollections({ name: 'orders' }).toArray();
    if (found.length === 0) {
      await db.createCollection('orders');
      console.log('Created empty orders collection');
    } else {
      console.log('Orders collection already exists (left unchanged)');
    }

    console.log('Seeding finished');
  } catch (err) {
    console.error('Seeding failed:', err.message);
    // Exit code 1 tells the terminal (and npm) that the script failed.
    process.exitCode = 1;
  } finally {
    // Always close the connection, otherwise Node keeps running.
    await closeDB();
  }
}

seed();
