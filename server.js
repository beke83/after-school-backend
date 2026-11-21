// server.js — entry point of the After School lessons REST API.
// Start it with "npm start" (or "npm run dev" to restart automatically on file changes).

// Load the variables from the .env file (MONGODB_URI, DB_NAME, PORT) into process.env.
// This must run first so the rest of the file can read them.
require('dotenv').config();

// Express is the web framework that handles HTTP requests and responses.
const express = require('express');

// Our own database helper (db.js): connectDB() opens the MongoDB connection.
const { connectDB } = require('./db');

// Our own logger middleware: prints one line per request (method, URL, status, time).
const logger = require('./middleware/logger');

// Our lessons routes (routes/lessons.js), e.g. GET /lessons.
const lessonsRouter = require('./routes/lessons');

// Our orders routes (routes/orders.js), e.g. POST /orders.
const ordersRouter = require('./routes/orders');

// Our search route (routes/search.js), e.g. GET /search?q=math.
const searchRouter = require('./routes/search');

// Our teachers routes (routes/teachers.js), e.g. GET /teachers.
const teachersRouter = require('./routes/teachers');

// Our enrolment route (routes/enrolment.js), e.g. GET /enrolment/<lesson _id>.
const enrolmentRouter = require('./routes/enrolment');

// Create the Express application object. All routes and middleware are added to it.
const app = express();

// Middleware runs in the order it is added, so the logger goes FIRST.
// That way every request is logged — including CORS preflights and 404s.
app.use(logger);

// ---------------------------------------------------------------------------
// CORS middleware (hand-written, no "cors" package)
// ---------------------------------------------------------------------------
// The front-end is hosted on GitHub Pages and this API is hosted on Render.
// They have different origins (different domains), so by default the browser
// blocks the front-end's fetch() calls to this API. These headers tell the
// browser that requests from other origins are allowed.
app.use(function (req, res, next) {
  // Allow requests from any origin ("*" = everyone).
  res.setHeader('Access-Control-Allow-Origin', '*');
  // The HTTP methods the front-end is allowed to use.
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  // The request headers the front-end is allowed to send (needed for JSON bodies).
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Before a POST or PUT with JSON, the browser first sends an OPTIONS
  // "preflight" request to ask if it is allowed. We answer with
  // 204 No Content (allowed, nothing to send back) and stop here.
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  // For every other request, carry on to the next middleware or route.
  next();
});

// Built-in middleware: reads a JSON request body (e.g. from POST /orders)
// and puts it into req.body as a normal JavaScript object.
// It comes AFTER the CORS middleware on purpose: if the body is broken JSON,
// express.json() stops with a 400 error. The CORS headers must already be set by
// then, otherwise the browser hides the 400 and shows a CORS error instead.
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — a simple check that the server is up and running.
app.get('/', function (req, res) {
  res.json({ message: 'After School API running' });
});

// Mount the lessons router: every URL starting with /lessons goes to routes/lessons.js.
app.use('/lessons', lessonsRouter);

// Mount the orders router: every URL starting with /orders goes to routes/orders.js.
app.use('/orders', ordersRouter);

// Mount the search router: every URL starting with /search goes to routes/search.js.
app.use('/search', searchRouter);

// Mount the teachers router: every URL starting with /teachers goes to routes/teachers.js.
app.use('/teachers', teachersRouter);

// Mount the enrolment router: every URL starting with /enrolment goes to routes/enrolment.js.
app.use('/enrolment', enrolmentRouter);

// ---------------------------------------------------------------------------
// 404 and error handling — these MUST come after all the routes
// ---------------------------------------------------------------------------

// Catch-all 404: Express checks the routes above in order. If none of them
// matched the URL, the request falls through to here, so the route doesn't exist.
// (No path is given, so this runs for any method and any URL.)
app.use(function (req, res) {
  res.status(404).json({ error: 'Route not found' });
});

// Error-handling middleware: Express knows it is the error handler because it has
// FOUR parameters (err, req, res, next). It runs when something calls next(err) or
// throws an error, for example when the browser sends broken JSON to express.json().
// "next" isn't used, but it must be listed or Express won't treat this as an error handler.
app.use(function (err, req, res, next) {
  // Log the full error in the terminal / Render's Logs tab so I can see what went wrong.
  console.error('Error:', err);

  // Some errors carry their own status code (broken JSON = 400 Bad Request).
  // Anything else is an unexpected problem on the server: 500 Internal Server Error.
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

// Render sets the PORT environment variable itself, so we must use it there.
// On my own computer it falls back to 3000.
const PORT = process.env.PORT || 3000;

// Connect to MongoDB FIRST, and only start listening once that works.
// Otherwise the server could accept requests while it has no database to answer them.
async function startServer() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    app.listen(PORT, function () {
      console.log('Server listening on port ' + PORT);
    });
  } catch (err) {
    // Connection failed (wrong URI, wrong password, IP not allowed in Atlas...).
    // Show why, and stop the process with exit code 1 (= "failed").
    console.error('Could not connect to MongoDB:', err.message);
    process.exit(1);
  }
}

startServer();
