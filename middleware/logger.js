// middleware/logger.js — logs every request to the console in one line, e.g.
//   [2026-11-09T14:03:22Z] GET /lessons → 200 (34ms)
// On Render, everything written with console.log appears in the service's "Logs" tab.
//
// How middleware works:
// Express passes every request through a chain of functions, in the order they were
// added with app.use(). Each middleware gets:
//   req  — the incoming request (method, URL, body...)
//   res  — the response we will send back
//   next — a function that hands the request on to the NEXT middleware or route.
// If a middleware does not call next() (and does not send a response),
// the request gets stuck and the browser waits forever.

// Fields that must NEVER be printed: anyone who can read the logs (e.g. Render's Logs tab)
// would otherwise see people's passwords and one-time codes in plain text.
const SECRET_FIELDS = ['password', 'newPassword', 'code'];

// Returns a copy of the body with the secret fields replaced by "***"
function hideSecrets(body) {
  const copy = { ...(body || {}) };          // copy, so the real req.body is not changed
  for (const field of SECRET_FIELDS) {
    if (copy[field] !== undefined) copy[field] = '***';
  }
  return copy;
}

function logger(req, res, next) {
  // Remember when the request arrived, so we can work out how long it took.
  const start = Date.now();

  // We can't log the status code yet: the route hasn't run, so there is no response.
  // res.on('finish', ...) registers a function that Express/Node calls later,
  // when the response has been completely sent to the client.
  res.on('finish', function () {
    const duration = Date.now() - start;

    // toISOString() gives "2026-11-09T14:03:22.123Z".
    // slice(0, 19) keeps "2026-11-09T14:03:22" and we add the "Z" (= UTC time) back.
    const time = new Date().toISOString().slice(0, 19) + 'Z';

    // originalUrl is the full path including any query string, e.g. /search?q=maths
    console.log('[' + time + '] ' + req.method + ' ' + req.originalUrl +
      ' → ' + res.statusCode + ' (' + duration + 'ms)');

    // For POST, PUT and PATCH, also show the JSON body that was sent (with secrets hidden).
    // By the time the response finishes, express.json() has already filled req.body.
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      console.log('  Body: ' + JSON.stringify(hideSecrets(req.body)));
    }
  });

  // Pass the request on to the next middleware / route straight away.
  next();
}

// Export the function so server.js can use it with app.use(logger).
module.exports = logger;
