// routes/lessons.js — all the routes that start with /lessons.
// server.js mounts this file with app.use('/lessons', lessonsRouter),
// so '/' in this file means '/lessons' in the browser.

const express = require('express');      // load Express
const router = express.Router();         // a mini app that only holds routes
const { getDB } = require('../db');      // our helper that gives us the connected database
const { ObjectId } = require('mongodb'); // MongoDB's id type, used to find a lesson by _id

// GET /lessons — send back every lesson as JSON
router.get('/', async (req, res) => {    // async so we can use "await" for the database
    try {
        const lessons = await getDB()    // get the database
            .collection('lessons')       // pick the "lessons" collection
            .find({})                    // {} = no filter, so match every lesson
            .toArray();                  // turn the results into a normal array
        res.json(lessons);               // send the array to the browser as JSON
    } catch (err) {                      // something went wrong (e.g. database problem)
        res.status(500).json({ error: err.message }); // 500 = server error, send the reason
    }
});

// PUT /lessons/:id — change any field(s) of one lesson
// Example: PUT /lessons/6560f1a2b3c4d5e6f7a8b9c0 with body { "space": 3 }
//
// How $set works: { $set: { space: 3, price: 90 } } tells MongoDB
// "set these fields to these values, and leave every other field alone".
// If a field doesn't exist yet, $set adds it. So whatever the body contains
// (space, price, topic, anything) is written exactly as sent.
//
// Why not $inc? $inc ADDS to a number (e.g. { $inc: { space: -1 } } takes 1 away).
// That only works for numbers and only changes them by an amount. This route must
// be able to set ANY field to ANY value (e.g. topic: "Art"), so $set is the right tool.
router.put('/:id', async (req, res) => {
    const id = req.params.id;            // the :id part of the URL

    // check the id looks like a MongoDB ObjectId before using it
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid lesson id' });
    }

    const updates = { ...req.body };     // copy the body so we don't change req.body itself
    delete updates._id;                  // never allow the _id to be changed

    // $set with nothing in it is an error in MongoDB, so stop early
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Nothing to update' });
    }

    try {
        const result = await getDB()     // get the database
            .collection('lessons')       // pick the "lessons" collection
            .updateOne(
                { _id: new ObjectId(id) },   // which lesson: the one with this _id
                { $set: updates }            // what to change: the fields from the body
            );

        // matchedCount = how many lessons had this _id (0 means none)
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        // modifiedCount = how many lessons actually changed
        // (0 if the new values were the same as the old ones)
        res.json({ message: 'Lesson updated', modified: result.modifiedCount });
    } catch (err) {                      // something went wrong with the database
        res.status(500).json({ error: err.message }); // 500 = server error, send the reason
    }
});

module.exports = router;                 // let server.js use this router
