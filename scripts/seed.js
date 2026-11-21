// scripts/seed.js — fills the database with the 12 starting lessons and 4 teachers.
// Run it with "npm run seed" (or "node scripts/seed.js") from the backend folder.
// WARNING: it deletes all existing lessons and teachers first, so every run starts fresh.

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

// The 4 teachers. "lessons" lists POSITIONS in the lessons array above
// (0 = Maths, 1 = English, ... 11 = Robotics). We can't write the real _ids here,
// because MongoDB only creates them when the lessons are inserted, and they are
// different on every run. After inserting, we swap each position for the real _id.
// Every lesson 0-11 appears at least once, so every lesson has a teacher.
const teachers = [
  { firstName: 'Sarah', lastName: 'Ahmed',  lessons: [0, 4, 5, 11] }, // Maths, Coding, Science, Robotics
  { firstName: 'James', lastName: 'Okafor', lessons: [1, 8, 10] },    // English, Drama, French
  { firstName: 'Priya', lastName: 'Patel',  lessons: [2, 3, 6] },     // Music, Art, Chess
  { firstName: 'Tom',   lastName: 'Wilson', lessons: [7, 9] }         // Football, Swimming
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

    // 3. Reset the teachers too, so they never point at old lessons that were just deleted.
    await db.collection('teachers').deleteMany({});

    // insertedIds holds the new _ids by position: { 0: ObjectId(...), 1: ObjectId(...), ... }
    // So inserted.insertedIds[0] is the _id of the first lesson (Maths), and so on.
    // For each teacher, turn the list of positions into a list of real lesson _ids.
    const teacherDocs = teachers.map(t => ({
      firstName: t.firstName,
      lastName: t.lastName,
      lessonIDs: t.lessons.map(i => inserted.insertedIds[i]) // position → ObjectId
    }));

    const insertedTeachers = await db.collection('teachers').insertMany(teacherDocs);
    console.log('Inserted ' + insertedTeachers.insertedCount + ' teachers');

    // 4. Make sure an "orders" collection exists (empty for now).
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
