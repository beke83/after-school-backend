// routes/admin.js — the admin dashboard API. Every route here needs an ADMIN login.
// server.js mounts this file with app.use('/admin', adminRouter),
// so '/stats' in this file means '/admin/stats' in the browser.
//
// Public routes are NOT here and stay open to everyone (they're the marked routes
// demonstrated in Postman): GET /lessons, PUT /lessons/:id, POST /orders.

const express = require('express');                                  // load Express
const router = express.Router();                                     // a mini app that only holds routes
const { getDB } = require('../db');                                  // the connected database
const { ObjectId } = require('mongodb');                             // MongoDB's id type
const { requireAuth, requireAdmin } = require('../middleware/auth'); // login + role checks

// router.use(...) without a path runs for EVERY route in this file, in this order:
// 1. requireAuth  → must send a valid "Authorization: Bearer <token>" (else 401)
// 2. requireAdmin → that user's role must be "admin" (else 403)
// So no admin route below can be reached by a guest or a normal user.
router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[0-9a-fA-F]{24}$/;   // what a MongoDB _id looks like as text
const NAME_PATTERN = /^[A-Za-z]+$/;       // letters only (teacher names)

// toObjectId(text) — turns a 24-hex-character id into an ObjectId, or returns null if it isn't one.
function toObjectId(text) {
    return typeof text === 'string' && ID_PATTERN.test(text) ? new ObjectId(text) : null;
}

// isText(value) — true for a string that isn't empty (after trimming spaces).
function isText(value) {
    return typeof value === 'string' && value.trim() !== '';
}

// readLesson(body, requireAll) — checks the lesson fields and returns
// { lesson } with the clean values, or { error } with what's wrong.
// requireAll = true for POST (every field needed), false for PUT (only the fields sent).
// Fields that aren't in this list are ignored, so an admin can't add random fields by mistake.
function readLesson(body, requireAll) {
    const data = body || {};
    const lesson = {};

    // For each field: if it's required OR it was sent, it must be valid.
    if (requireAll || data.topic !== undefined) {
        if (!isText(data.topic)) return { error: 'topic must be some text' };
        lesson.topic = data.topic.trim();
    }
    if (requireAll || data.location !== undefined) {
        if (!isText(data.location)) return { error: 'location must be some text' };
        lesson.location = data.location.trim();
    }
    if (requireAll || data.price !== undefined) {
        if (typeof data.price !== 'number' || data.price < 0) return { error: 'price must be a number of 0 or more' };
        lesson.price = data.price;
    }
    if (requireAll || data.space !== undefined) {
        if (!Number.isInteger(data.space) || data.space < 0) return { error: 'space must be a whole number of 0 or more' };
        lesson.space = data.space;
    }
    if (requireAll || data.icon !== undefined) {
        if (!isText(data.icon)) return { error: 'icon must be a Font Awesome class, e.g. "fa-solid fa-book"' };
        lesson.icon = data.icon.trim();
    }
    // image is optional, even when creating
    if (data.image !== undefined) {
        if (typeof data.image !== 'string') return { error: 'image must be a file name' };
        lesson.image = data.image.trim();
    }

    if (Object.keys(lesson).length === 0) return { error: 'Nothing to update' };
    return { lesson: lesson };
}

// readTeacher(body, requireAll) — same idea for teachers.
// lessonIDs must be a list of real lesson _ids (it may be empty: a teacher with no lessons yet).
async function readTeacher(body, requireAll) {
    const data = body || {};
    const teacher = {};

    if (requireAll || data.firstName !== undefined) {
        if (typeof data.firstName !== 'string' || !NAME_PATTERN.test(data.firstName.trim())) {
            return { error: 'firstName must contain letters only' };
        }
        teacher.firstName = data.firstName.trim();
    }
    if (requireAll || data.lastName !== undefined) {
        if (typeof data.lastName !== 'string' || !NAME_PATTERN.test(data.lastName.trim())) {
            return { error: 'lastName must contain letters only' };
        }
        teacher.lastName = data.lastName.trim();
    }
    if (requireAll || data.lessonIDs !== undefined) {
        if (!Array.isArray(data.lessonIDs)) return { error: 'lessonIDs must be a list of lesson ids' };

        // new Set(...) removes duplicates, so the same lesson can't be assigned twice.
        const unique = [...new Set(data.lessonIDs)];
        const ids = unique.map(toObjectId);
        if (ids.includes(null)) return { error: 'Each lessonID must be a valid lesson _id' };

        // Every id must belong to a lesson that really exists.
        // countDocuments with $in counts how many of these ids are in the lessons collection.
        const found = await getDB().collection('lessons').countDocuments({ _id: { $in: ids } });
        if (found !== ids.length) return { error: 'One or more lessons do not exist' };

        teacher.lessonIDs = ids;   // saved as ObjectIds, like the seed script does
    }

    if (Object.keys(teacher).length === 0) return { error: 'Nothing to update' };
    return { teacher: teacher };
}

// ---------------------------------------------------------------------------
// GET /admin/stats — numbers for the dashboard
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
    try {
        const db = getDB();

        // countDocuments({}) counts every document in a collection
        const lessonCount = await db.collection('lessons').countDocuments({});
        const orderCount = await db.collection('orders').countDocuments({});
        const userCount = await db.collection('users').countDocuments({});

        // To work out revenue we need each lesson's price. Make a lookup:
        // { "6560f1...": 100, "6560f2...": 90, ... }  (lesson _id as text → price)
        const lessons = await db.collection('lessons').find({}).toArray();
        const priceOf = {};
        for (const lesson of lessons) {
            priceOf[String(lesson._id)] = lesson.price;
        }

        // Go through every order. spaces[i] is the number of spaces booked for lessonIDs[i].
        let totalSpaces = 0;
        let revenue = 0;
        const orders = await db.collection('orders').find({}).toArray();
        for (const order of orders) {
            for (let i = 0; i < order.lessonIDs.length; i++) {
                totalSpaces = totalSpaces + order.spaces[i];
                // Orders don't store the price, so we use the lesson's CURRENT price.
                // A lesson that was deleted has no price any more and counts as 0.
                const price = priceOf[String(order.lessonIDs[i])] || 0;
                revenue = revenue + order.spaces[i] * price;
            }
        }

        res.json({
            lessons: lessonCount,
            orders: orderCount,
            users: userCount,
            spacesBooked: totalSpaces,
            revenue: revenue
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// LESSONS
// ---------------------------------------------------------------------------

// POST /admin/lessons — add a new lesson
// Body: { topic, location, price, space, icon, image? }
router.post('/lessons', async (req, res) => {
    const result = readLesson(req.body, true);       // true = every field is required
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    try {
        const inserted = await getDB().collection('lessons').insertOne(result.lesson);
        res.status(201).json({ message: 'Lesson created', lessonId: inserted.insertedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /admin/lessons/:id — change some fields of a lesson (with validation).
// (Different from the public PUT /lessons/:id, which must accept ANY field for the marking.)
router.put('/lessons/:id', async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'Invalid lesson id' });
    }

    const result = readLesson(req.body, false);      // false = only check the fields sent
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    try {
        const updated = await getDB().collection('lessons').updateOne({ _id: id }, { $set: result.lesson });
        if (updated.matchedCount === 0) {
            return res.status(404).json({ error: 'Lesson not found' });
        }
        res.json({ message: 'Lesson updated', modified: updated.modifiedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /admin/lessons/:id — remove a lesson, and remove it from every teacher
router.delete('/lessons/:id', async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'Invalid lesson id' });
    }

    try {
        const db = getDB();
        const deleted = await db.collection('lessons').deleteOne({ _id: id });
        if (deleted.deletedCount === 0) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        // Teachers store lesson ids (references). If we left this id in their lessonIDs,
        // it would point to a lesson that no longer exists.
        // $pull removes a value from an array; updateMany with {} does it for EVERY teacher.
        await db.collection('teachers').updateMany({}, { $pull: { lessonIDs: id } });

        // Orders are NOT changed: they're a record of what was bought in the past.
        res.json({ message: 'Lesson deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// TEACHERS
// ---------------------------------------------------------------------------

// GET /admin/teachers — every teacher
router.get('/teachers', async (req, res) => {
    try {
        const teachers = await getDB().collection('teachers').find({}).toArray();
        res.json(teachers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /admin/teachers/:id — one teacher
router.get('/teachers/:id', async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'Invalid teacher id' });
    }

    try {
        const teacher = await getDB().collection('teachers').findOne({ _id: id });
        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        res.json(teacher);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /admin/teachers — add a teacher
// Body: { firstName, lastName, lessonIDs: ["6560f1...", ...] }  (lessonIDs can be [])
router.post('/teachers', async (req, res) => {
    try {
        const result = await readTeacher(req.body, true);
        if (result.error) {
            return res.status(400).json({ error: result.error });
        }

        const inserted = await getDB().collection('teachers').insertOne(result.teacher);
        res.status(201).json({ message: 'Teacher created', teacherId: inserted.insertedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /admin/teachers/:id — change a teacher's name and/or assigned lessons
// Sending lessonIDs REPLACES the whole list, e.g. { "lessonIDs": ["6560f1...", "6560f4..."] }
router.put('/teachers/:id', async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'Invalid teacher id' });
    }

    try {
        const result = await readTeacher(req.body, false);
        if (result.error) {
            return res.status(400).json({ error: result.error });
        }

        const updated = await getDB().collection('teachers').updateOne({ _id: id }, { $set: result.teacher });
        if (updated.matchedCount === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        res.json({ message: 'Teacher updated', modified: updated.modifiedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /admin/teachers/:id — remove a teacher (their lessons stay)
router.delete('/teachers/:id', async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'Invalid teacher id' });
    }

    try {
        const deleted = await getDB().collection('teachers').deleteOne({ _id: id });
        if (deleted.deletedCount === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        res.json({ message: 'Teacher deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------

// GET /admin/orders — every order, newest first, with the lesson topics added in
router.get('/orders', async (req, res) => {
    try {
        const db = getDB();

        // Query 1: all orders. sort({ createdAt: -1 }) = newest first (-1 = descending).
        const orders = await db.collection('orders').find({}).sort({ createdAt: -1 }).toArray();

        // Orders only store lesson ids. To show topics we "join" them in ourselves:
        // Query 2: get every lesson used by these orders, all in ONE query with $in.
        const allIds = [];
        for (const order of orders) {
            for (const lessonId of order.lessonIDs) {
                allIds.push(lessonId);
            }
        }
        const lessons = await db.collection('lessons').find({ _id: { $in: allIds } }).toArray();

        // Lookup: lesson _id as text → topic
        const topicOf = {};
        for (const lesson of lessons) {
            topicOf[String(lesson._id)] = lesson.topic;
        }

        // Add a "lessons" list to each order: [{ lessonId, topic, spaces }, ...]
        // Again spaces[i] belongs to lessonIDs[i]. A deleted lesson shows as "(deleted lesson)".
        const result = orders.map(order => ({
            ...order,
            lessons: order.lessonIDs.map((lessonId, i) => ({
                lessonId: lessonId,
                topic: topicOf[String(lessonId)] || '(deleted lesson)',
                spaces: order.spaces[i]
            }))
        }));

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------

// GET /admin/users — every user, newest first, WITHOUT password hashes
router.get('/users', async (req, res) => {
    try {
        const users = await getDB().collection('users')
            .find({}, { projection: { passwordHash: 0 } })   // 0 = leave this field out
            .sort({ createdAt: -1 })
            .toArray();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /admin/users/:id/role — make a user an admin, or a normal user again
// Body: { "role": "admin" } or { "role": "user" }
// PATCH (not PUT) because we change just ONE field of the user.
router.patch('/users/:id/role', async (req, res) => {
    const id = toObjectId(req.params.id);
    const role = (req.body || {}).role;

    if (!id) {
        return res.status(400).json({ error: 'Invalid user id' });
    }
    if (role !== 'user' && role !== 'admin') {
        return res.status(400).json({ error: 'role must be "user" or "admin"' });
    }
    // req.user is the admin making this request (set by requireAuth).
    // .equals() compares two ObjectIds by value.
    // An admin can't demote themselves, so there's always at least one admin left.
    if (id.equals(req.user._id) && role !== 'admin') {
        return res.status(400).json({ error: "You can't remove your own admin role" });
    }

    try {
        const updated = await getDB().collection('users').updateOne({ _id: id }, { $set: { role: role } });
        if (updated.matchedCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'Role updated', role: role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /admin/users/:id — delete a user account
router.delete('/users/:id', async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'Invalid user id' });
    }
    // An admin can't delete their own account (they'd lock themselves out).
    if (id.equals(req.user._id)) {
        return res.status(400).json({ error: "You can't delete your own account" });
    }

    try {
        const db = getDB();
        const deleted = await db.collection('users').deleteOne({ _id: id });
        if (deleted.deletedCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Log the deleted user out everywhere, so their token stops working at once.
        await db.collection('sessions').deleteMany({ userId: id });
        // Their orders stay (a record of sales); the userId just no longer matches a user.
        res.json({ message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;   // let server.js use this router
