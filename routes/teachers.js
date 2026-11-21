// routes/teachers.js — all the routes that start with /teachers.
// server.js mounts this file with app.use('/teachers', teachersRouter),
// so '/' in this file means '/teachers' in the browser.

const express = require('express');      // load Express
const router = express.Router();         // a mini app that only holds routes
const { getDB } = require('../db');      // our helper that gives us the connected database
const { ObjectId } = require('mongodb'); // MongoDB's id type, used to find a teacher by _id

// How teachers and lessons are linked:
// A teacher document does NOT contain copies of its lessons. It only stores their ids:
//   { firstName: 'Sarah', lastName: 'Ahmed', lessonIDs: [ObjectId('...'), ObjectId('...')] }
// Each id in lessonIDs is the _id of a document in the "lessons" collection.
// This is a "reference", like a foreign key in SQL: to get the actual lessons,
// we read the ids from the teacher, then look them up in the lessons collection.
// Because only ids are stored, a lesson's details (price, space...) live in ONE place,
// so changing a lesson never leaves an out-of-date copy inside a teacher.

// GET /teachers — send back every teacher as JSON
// Each teacher has: _id, firstName, lastName, lessonIDs
router.get('/', async (req, res) => {
    try {
        const teachers = await getDB()   // get the database
            .collection('teachers')      // pick the "teachers" collection
            .find({})                    // {} = no filter, so match every teacher
            .toArray();                  // turn the results into a normal array
        res.json(teachers);              // send the array to the browser as JSON
    } catch (err) {                      // something went wrong with the database
        res.status(500).json({ error: err.message }); // 500 = server error, send the reason
    }
});

// GET /teachers/:id/lessons — send back the full lessons taught by one teacher
// Example: GET /teachers/6560f1a2b3c4d5e6f7a8b9c0/lessons
router.get('/:id/lessons', async (req, res) => {
    const id = req.params.id;            // the :id part of the URL

    // check the id looks like a MongoDB ObjectId before using it
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid teacher id' });
    }

    try {
        const db = getDB();              // get the database

        // Step 1: find the teacher by _id
        const teacher = await db.collection('teachers').findOne({ _id: new ObjectId(id) });

        // no teacher with this _id → 404 Not Found
        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Step 2: follow the references. $in means "_id is any one of these ids",
        // so this finds every lesson whose _id is in the teacher's lessonIDs list.
        const lessons = await db.collection('lessons')
            .find({ _id: { $in: teacher.lessonIDs } })
            .toArray();

        res.json(lessons);               // send the teacher's lessons as JSON
    } catch (err) {                      // something went wrong with the database
        res.status(500).json({ error: err.message }); // 500 = server error, send the reason
    }
});

module.exports = router;                 // let server.js use this router
