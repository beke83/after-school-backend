// routes/lessons.js — all the routes that start with /lessons.
// server.js mounts this file with app.use('/lessons', lessonsRouter),
// so '/' in this file means '/lessons' in the browser.

const express = require('express');      // load Express
const router = express.Router();         // a mini app that only holds routes
const { getDB } = require('../db');      // our helper that gives us the connected database

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

module.exports = router;                 // let server.js use this router
