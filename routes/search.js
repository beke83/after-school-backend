// routes/search.js — the search route.
// server.js mounts this file with app.use('/search', searchRouter),
// so '/' in this file means '/search' in the browser.

const express = require('express');      // load Express
const router = express.Router();         // a mini app that only holds routes
const { getDB } = require('../db');      // our helper that gives us the connected database

// GET /search?q=term — find lessons whose topic, location, price or space contains "term"
// Examples: /search?q=math   /search?q=hendon   /search?q=1 (matches price 100, 120...)
router.get('/', async (req, res) => {
    // Step 1: read the search text from the URL (?q=...).
    // If there is no q, use '' (empty). trim() removes spaces at the start and end.
    const q = String(req.query.q || '').trim();

    try {
        const lessons = getDB().collection('lessons'); // the "lessons" collection

        // Step 2: empty search → send back every lesson (same as GET /lessons).
        if (q === '') {
            const all = await lessons.find({}).toArray();
            return res.json(all);
        }

        // Step 3: escape regex special characters.
        // In a regex, characters like . * + ? ( ) [ ] mean something special.
        // Example: "." means "any character", so a search for "." would match everything.
        // A "(" on its own is an invalid regex and would make MongoDB throw an error.
        // Putting a \ in front of each special character makes it mean just itself.
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& = the character that matched

        // Step 4: build the query. $or means "match if ANY of these is true".
        const query = {
            $or: [
                // topic and location are text, so $regex can search them directly.
                // $options: 'i' = ignore case, so "math" also finds "Math".
                { topic: { $regex: safe, $options: 'i' } },
                { location: { $regex: safe, $options: 'i' } },

                // price and space are NUMBERS, and $regex only works on text.
                // $expr lets us use an expression instead of a plain field match:
                //   $toString turns the number into text (100 → "100"),
                //   $regexMatch checks if our search text is inside it.
                // So searching "1" matches a price of 100.
                { $expr: { $regexMatch: { input: { $toString: '$price' }, regex: safe, options: 'i' } } },
                { $expr: { $regexMatch: { input: { $toString: '$space' }, regex: safe, options: 'i' } } }
            ]
        };

        // Step 5: run the query and send the matching lessons as JSON.
        const results = await lessons.find(query).toArray();
        res.json(results);
    } catch (err) {                      // something went wrong with the database
        res.status(500).json({ error: err.message }); // 500 = server error, send the reason
    }
});

module.exports = router;                 // let server.js use this router
