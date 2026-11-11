// server.js — entry point of the After School lessons REST API.
// Start it with "npm start" (or "npm run dev" to restart automatically on file changes).

// Load the variables from the .env file (MONGODB_URI, DB_NAME, PORT) into process.env.
// This must run first so the rest of the file can read them.
require('dotenv').config();

// Express is the web framework that handles HTTP requests and responses.
const express = require('express');

// Create the Express application object. All routes and middleware are added to it.
const app = express();

// Built-in middleware: reads a JSON request body (e.g. from POST /orders)
// and puts it into req.body as a normal JavaScript object.
app.use(express.json());

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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — a simple check that the server is up and running.
app.get('/', function (req, res) {
  res.json({ message: 'After School API running' });
});

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

// Render sets the PORT environment variable itself, so we must use it there.
// On my own computer it falls back to 3000.
const PORT = process.env.PORT || 3000;

app.listen(PORT, function () {
  console.log('Server listening on port ' + PORT);
});
