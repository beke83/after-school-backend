// routes/enrolment.js — how many spaces have been booked for a lesson.
// server.js mounts this file with app.use('/enrolment', enrolmentRouter),
// so '/:lessonid' in this file means '/enrolment/:lessonid' in the browser.

const express = require('express');      // load Express
const router = express.Router();         // a mini app that only holds routes
const { getDB } = require('../db');      // our helper that gives us the connected database
const { ObjectId } = require('mongodb'); // MongoDB's id type, used to find by _id

// GET /enrolment/:lessonid — total spaces booked for one lesson, across all orders
// Example: GET /enrolment/6560f1a2b3c4d5e6f7a8b9c0
// Response: { lessonId: "6560f1...", topic: "Maths", enrolled: 7 }
router.get('/:lessonid', async (req, res) => {
    const id = req.params.lessonid;      // the :lessonid part of the URL

    // check the id looks like a MongoDB ObjectId before using it
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid lesson id' });
    }

    const lessonId = new ObjectId(id);   // turn the text into a real ObjectId

    try {
        const db = getDB();              // get the database

        // Step 1: make sure the lesson exists (we also need its topic for the reply)
        const lesson = await db.collection('lessons').findOne({ _id: lessonId });
        if (!lesson) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        // Step 2: find every order that booked this lesson.
        // When a field is an array, { lessonIDs: lessonId } matches any order
        // whose lessonIDs array CONTAINS lessonId (anywhere in the list).
        const orders = await db.collection('orders')
            .find({ lessonIDs: lessonId })
            .toArray();

        // Step 3: add up the spaces booked for this lesson.
        // An order stores two arrays that go together by position:
        //   lessonIDs: [Maths, Art]
        //   spaces:    [  2,    1 ]
        // spaces[i] is the number of spaces booked for lessonIDs[i].
        // So we can't just add up all the spaces in the order (that would count Art too).
        // We find the POSITION (index) of our lesson in lessonIDs, then read the
        // spaces at that SAME position.
        let total = 0;
        for (const order of orders) {                     // go through each order
            for (let i = 0; i < order.lessonIDs.length; i++) { // go through each position
                // ObjectIds are objects, so === would compare two different objects
                // and always be false. .equals() compares the actual id values.
                if (order.lessonIDs[i].equals(lessonId)) {
                    total = total + order.spaces[i];     // add the spaces at the same position
                }
            }
        }

        // Step 4: send back the lesson id, its topic and the total
        res.json({ lessonId: lesson._id, topic: lesson.topic, enrolled: total });
    } catch (err) {                      // something went wrong with the database
        res.status(500).json({ error: err.message }); // 500 = server error, send the reason
    }
});

module.exports = router;                 // let server.js use this router
