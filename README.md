# After School Lessons — Back-end API

A REST API for the CST3144 after-school lessons app. It's built with **Express.js** and stores lessons, orders and teachers in **MongoDB Atlas**, using the native `mongodb` driver (no Mongoose). The Vue.js front-end calls this API with `fetch()` to list and search lessons, place orders and update the free spaces.

## Links

- **[Vue.js App] GitHub repo:** _add link here_
- **[Vue.js App] GitHub Pages:** _add link here_
- **[Express.js App] GitHub repo:** _add link here_
- **[Express.js App] Render /lessons URL:** _add link here_

## Tech stack

| Technology | Used for |
|---|---|
| **Node.js** (18 or newer) | Runs the server |
| **Express.js** 5 | Routes, middleware and JSON responses |
| **MongoDB Atlas** | Cloud database (collections: `lessons`, `orders`, `teachers`) |
| **mongodb** (native driver) | Connecting to and querying the database |
| **dotenv** | Loads settings (connection string, port) from `.env` |
| **Node `crypto`** (built in) | Password hashing (scrypt with a random salt) |
| **Brevo HTTP API** (via built-in `fetch`) | Sending emails (Render's free tier blocks SMTP) |
| **Render** | Hosts the live API |

CORS is handled by a small middleware written by hand in `server.js`, not by the `cors` package. There are no other dependencies.

## Folder structure

```
backend/
├── server.js            Entry point: middleware, mounts the routes, 404 + error handler, starts the server
├── db.js                MongoDB connection: connectDB(), getDB(), closeDB()
├── package.json         Scripts (start, dev, seed) and dependencies
├── .env.example         The settings you need (copy to .env)
├── utils/
│   ├── password.js      hashPassword / verifyPassword (salted scrypt, built-in crypto)
│   ├── email.js         sendEmail through Brevo's HTTP API, plus the branded code email
│   └── otp.js           createOtp / checkOtp: 6-digit email codes (hashed, 10 min, max 5 tries)
├── middleware/
│   └── logger.js        Logs every request: [time] METHOD /url → status (ms)
├── routes/
│   ├── lessons.js       GET /lessons, PUT /lessons/:id
│   ├── orders.js        POST /orders
│   ├── search.js        GET /search?q=
│   ├── teachers.js      GET /teachers, GET /teachers/:id/lessons
│   ├── enrolment.js     GET /enrolment/:lessonid
│   └── auth.js          POST /auth/signup, /auth/verify-email, /auth/resend-otp
├── scripts/
│   └── seed.js          Resets the database: 12 lessons and 4 teachers
├── public/images/       Lesson images
├── postman/             Exported Postman collection
└── exports/             Exported MongoDB collections
```

## Setup (run locally)

1. Install the dependencies:
   ```
   npm install
   ```
2. Create your `.env` file from the example and fill it in:
   ```
   cp .env.example .env
   ```
   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
   DB_NAME=afterschool
   PORT=3000
   BREVO_API_KEY=            # optional locally: if empty, emails are printed in the terminal
   EMAIL_FROM=               # a sender address verified in Brevo
   EMAIL_FROM_NAME=After School Lessons
   ADMIN_EMAIL=
   ADMIN_PASSWORD=
   ```
   In MongoDB Atlas, your IP address must be allowed under **Network Access**.
3. Fill the database with the starting lessons and teachers. **Warning:** this deletes and recreates all lessons and teachers. Existing orders are kept.
   ```
   npm run seed
   ```
4. Start the server:
   ```
   npm start
   ```
   Then open <http://localhost:3000/lessons>. Use `npm run dev` instead to restart automatically when a file changes.

## Routes

All responses are JSON. Ids are MongoDB `_id` values (24 hex characters).

| Method | Path | Body | Example response |
|---|---|---|---|
| GET | `/` | — | `{ "message": "After School API running" }` |
| GET | `/lessons` | — | `[ { "_id": "6560f1…", "topic": "Maths", "location": "Hendon", "price": 100, "space": 5, "icon": "fa-solid fa-calculator", "image": "maths.png" }, … ]` |
| PUT | `/lessons/:id` | Any field(s) to change, e.g. `{ "space": 3 }` | `{ "message": "Lesson updated", "modified": 1 }` |
| POST | `/orders` | `{ "name": "Jane Doe", "phone": "07123456789", "lessonIDs": ["6560f1…", "6560f2…"], "spaces": [2, 1] }` | `201` `{ "message": "Order created", "orderId": "6561a0…" }` |
| GET | `/search?q=term` | — | Lessons whose topic, location, price or space contains `term` (ignores case). An empty `q` returns all lessons. `[ { "_id": "6560f1…", "topic": "Maths", … } ]` |
| GET | `/teachers` | — | `[ { "_id": "6560f9…", "firstName": "Sarah", "lastName": "Ahmed", "lessonIDs": ["6560f1…", …] }, … ]` |
| GET | `/teachers/:id/lessons` | — | The teacher's lessons: `[ { "_id": "6560f1…", "topic": "Maths", … }, … ]` |
| GET | `/enrolment/:lessonid` | — | `{ "lessonId": "6560f1…", "topic": "Maths", "enrolled": 7 }` |
| POST | `/auth/signup` | `{ "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com", "password": "abcdefg1" }` | `201` `{ "message": "Account created. We sent a 6-digit code to your email.", "email": "jane@example.com" }` (`409` if the email is taken) |
| POST | `/auth/verify-email` | `{ "email": "jane@example.com", "code": "123456" }` | `{ "message": "Email verified. You can now log in." }` |
| POST | `/auth/resend-otp` | `{ "email": "jane@example.com", "purpose": "verify" }` (or `"reset"`) | `{ "message": "If this email needs a code, we have sent a new one." }` (`429` if asked again within 60 s) |

**Errors**

| Status | When | Example response |
|---|---|---|
| `400` | Invalid id, failed order validation, nothing to update, broken JSON | `{ "error": "Phone must contain numbers only" }` |
| `404` | No lesson/teacher with that id, or the route doesn't exist | `{ "error": "Route not found" }` |
| `409` | Sign-up with an email that already has an account | `{ "error": "An account with this email already exists" }` |
| `429` | A new code was asked for within 60 seconds | `{ "error": "Please wait 60 seconds before asking for another code" }` |
| `500` | Database or server error | `{ "error": "…" }` |

**Order validation:** `name` must be letters and spaces only, and `phone` must be digits only. `lessonIDs` and `spaces` must be non-empty arrays of the same length. Every lesson id must be a valid `_id`, and every space must be a positive whole number. `spaces[i]` is the number of spaces booked for `lessonIDs[i]`.

## AI use

AI tools (Claude) helped draft parts of this back-end and this README. I reviewed, ran and tested all the code, and I can explain every line. The code follows the patterns taught in the CST3144 labs and workshops.
