// middleware/auth.js — checks who is making a request, using the login token.
//
// HOW THE TOKEN IS CHECKED ON EVERY REQUEST
// 1. When a user logs in (POST /auth/login), the server makes a long random token and
//    saves a "session" in MongoDB: { token, userId, expiresAt: now + 7 days }.
//    The token is sent to the front-end, which keeps it (e.g. in localStorage).
// 2. On every request that needs a login, the front-end sends the token in a header:
//      Authorization: Bearer 3f9a1c...e07b
// 3. This middleware reads that header, takes the part after "Bearer ",
//    and looks for a session with that token in the database.
// 4. No session, or the session has expired → the user is NOT logged in (401).
// 5. Otherwise it loads the user the session belongs to (session.userId → users._id),
//    puts it in req.user, and calls next() so the route can run and use req.user.
//
// The server remembers nothing between requests: the token is checked against the
// database EVERY time. Logging out simply deletes the session, so the token stops working.

const { getDB } = require('../db');      // our helper that gives us the connected database

// getUserFromToken(req) — returns { user, token } if the request has a valid token,
// or null if it doesn't. Shared by requireAuth and by routes where login is optional.
async function getUserFromToken(req) {
    // Step 2-3: read "Authorization: Bearer <token>"
    const header = req.headers.authorization || '';   // Express gives header names in lowercase
    if (!header.startsWith('Bearer ')) {
        return null;                                  // no token sent
    }
    const token = header.slice(7).trim();             // remove "Bearer " (7 characters)
    if (token === '') {
        return null;
    }

    const db = getDB();

    // Step 3-4: find the session and make sure it hasn't expired.
    // (The TTL index deletes expired sessions, but only about once a minute,
    //  so we check expiresAt ourselves too.)
    const session = await db.collection('sessions').findOne({ token: token });
    if (!session || session.expiresAt < new Date()) {
        return null;
    }

    // Step 5: load the user. The projection { passwordHash: 0 } means
    // "give me every field EXCEPT passwordHash", so the hash never leaves the database.
    const user = await db.collection('users').findOne(
        { _id: session.userId },
        { projection: { passwordHash: 0 } }
    );
    if (!user) {
        return null;                                  // the account was deleted
    }

    return { user: user, token: token };
}

// requireAuth — put this in front of a route that needs a logged-in user, e.g.
//   router.get('/me', requireAuth, (req, res) => { ... req.user ... })
async function requireAuth(req, res, next) {
    try {
        const result = await getUserFromToken(req);
        if (!result) {
            // 401 Unauthorized = "you need to log in"
            return res.status(401).json({ error: 'Please log in' });
        }
        req.user = result.user;      // the route can now use req.user
        req.token = result.token;    // logout needs to know which session to delete
        next();                      // carry on to the route
    } catch (err) {
        next(err);                   // database problem → our error handler in server.js
    }
}

// requireAdmin — put this AFTER requireAuth, e.g.
//   router.get('/admin-thing', requireAuth, requireAdmin, (req, res) => { ... })
// requireAuth has already checked the login; this checks the user's role.
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        // 403 Forbidden = "we know who you are, but you're not allowed to do this"
        return res.status(403).json({ error: 'Admins only' });
    }
    next();
}

module.exports = { getUserFromToken, requireAuth, requireAdmin };  // let other files use them
