// routes/orders.js — all the routes that start with /orders.
// server.js mounts this file with app.use('/orders', ordersRouter),
// so '/' in this file means '/orders' in the browser.

const express = require('express');      // load Express
const router = express.Router();         // a mini app that only holds routes
const { getDB } = require('../db');      // our helper that gives us the connected database

// Why validate here when the front-end already checks the form?
// - The front-end check is for the USER: it gives instant feedback before sending.
// - The back-end check is for SAFETY: anyone can skip the front-end and send a
//   request straight to the API (e.g. with Postman), or turn off JavaScript.
//   The server is the only place we fully control, so it must never trust the data.

// POST /orders — save a new order
// Expected body: { name, phone, lessonIDs: [...], spaces: [...] }
router.post('/', async (req, res) => {
    const { name, phone, lessonIDs, spaces } = req.body || {}; // take the fields out of the body

    // name: letters and spaces only (and not empty)
    if (typeof name !== 'string' || !/^[A-Za-z\s]+$/.test(name)) {
        return res.status(400).json({ error: 'Name must contain letters and spaces only' });
    }

    // phone: numbers only (and not empty)
    if (typeof phone !== 'string' || !/^[0-9]+$/.test(phone)) {
        return res.status(400).json({ error: 'Phone must contain numbers only' });
    }

    // lessonIDs and spaces: both must be arrays with at least one item
    if (!Array.isArray(lessonIDs) || !Array.isArray(spaces) || lessonIDs.length === 0) {
        return res.status(400).json({ error: 'lessonIDs and spaces must be non-empty arrays' });
    }

    // one "spaces" number for every lesson, so the lengths must match
    if (lessonIDs.length !== spaces.length) {
        return res.status(400).json({ error: 'lessonIDs and spaces must be the same length' });
    }

    // every spaces value must be a whole number bigger than 0 (1, 2, 3...)
    for (const s of spaces) {
        if (!Number.isInteger(s) || s <= 0) {
            return res.status(400).json({ error: 'Each spaces value must be a positive whole number' });
        }
    }

    try {
        const result = await getDB()          // get the database
            .collection('orders')             // pick the "orders" collection
            .insertOne({                      // add one new document
                name: name,
                phone: phone,
                lessonIDs: lessonIDs,
                spaces: spaces,
                createdAt: new Date()         // the date and time the order was made
            });
        res.status(201).json({                // 201 = "Created"
            message: 'Order created',
            orderId: result.insertedId        // the _id MongoDB gave the new order
        });
    } catch (err) {                           // something went wrong with the database
        res.status(500).json({ error: err.message }); // 500 = server error, send the reason
    }
});

module.exports = router;                      // let server.js use this router
