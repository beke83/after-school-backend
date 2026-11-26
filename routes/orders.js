// routes/orders.js — all the routes that start with /orders.
// server.js mounts this file with app.use('/orders', ordersRouter),
// so '/' in this file means '/orders' in the browser.

const express = require('express');      // load Express
const router = express.Router();         // a mini app that only holds routes
const { getDB } = require('../db');      // our helper that gives us the connected database
const { ObjectId } = require('mongodb'); // MongoDB's id type, used for the lessons' _id
const { getUserFromToken } = require('../middleware/auth'); // reads the login token (if any)

// Why validate here when the front-end already checks the form?
// - The front-end check is for the USER: it gives instant feedback before sending.
// - The back-end check is for SAFETY: anyone can skip the front-end and send a
//   request straight to the API (e.g. with Postman), or turn off JavaScript.
//   The server is the only place we fully control, so it must never trust the data.

// POST /orders — save a new order
// Expected body: { name, phone, lessonIDs: [...], spaces: [...] }
// The two arrays go together by position: spaces[i] is the number of spaces
// booked for lessonIDs[i]. Example: lessonIDs ['A', 'B'], spaces [2, 1]
// means 2 spaces in lesson A and 1 space in lesson B.
//
// LOGIN IS OPTIONAL HERE (guests can still order — this is a marked route).
// So we do NOT use requireAuth. Instead, if the request happens to carry a valid
// "Authorization: Bearer <token>", we look up the user and save their _id on the order.
// No token, or a bad/expired token → it's simply saved as a guest order (userId: null).
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

    // every lessonID must look like a MongoDB _id: exactly 24 hex characters (0-9, a-f)
    for (const id of lessonIDs) {
        if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({ error: 'Each lessonID must be a valid lesson _id' });
        }
    }

    // every spaces value must be a whole number bigger than 0 (1, 2, 3...)
    for (const s of spaces) {
        if (!Number.isInteger(s) || s <= 0) {
            return res.status(400).json({ error: 'Each spaces value must be a positive whole number' });
        }
    }

    // The browser sends the ids as text, but in the database a lesson's _id is an
    // ObjectId. Converting them means the order stores the same type as the lessons,
    // so later we can find a lesson with { _id: order.lessonIDs[i] }.
    const lessonObjectIds = lessonIDs.map(id => new ObjectId(id));

    try {
        // Logged in? getUserFromToken returns { user, token } or null (guest).
        const login = await getUserFromToken(req);

        const result = await getDB()          // get the database
            .collection('orders')             // pick the "orders" collection
            .insertOne({                      // add one new document
                name: name,
                phone: phone,
                lessonIDs: lessonObjectIds,   // the converted ObjectIds, not the text
                spaces: spaces,
                userId: login ? login.user._id : null, // the logged-in user's _id, or null for a guest
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
