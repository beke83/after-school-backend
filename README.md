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
│   ├── email.js         sendEmail / sendTemplateEmail (with PDF attachment) through Brevo's HTTP API
│   ├── otp.js           createOtp / checkOtp: 6-digit email codes (hashed, 10 min, max 5 tries)
│   ├── orderChecks.js   checkOrderBody: the field checks shared by /orders and /payments
│   ├── pricing.js       calculateOrder: real prices from MongoDB, space check, total in £ and kobo
│   ├── paystack.js      initializeTransaction / verifyTransaction (Paystack TEST mode, built-in fetch)
│   └── receipt.js       createReceiptPdf: the PDF booking confirmation (pdfkit)
├── middleware/
│   ├── logger.js        Logs every request: [time] METHOD /url → status (ms)
│   └── auth.js          requireAuth (Bearer token → req.user) and requireAdmin
├── routes/
│   ├── lessons.js       GET /lessons, PUT /lessons/:id
│   ├── orders.js        POST /orders (checks Paystack payments, emails the receipt), GET /orders/:id/receipt
│   ├── payments.js      POST /payments/initialize (starts a Paystack test payment)
│   ├── search.js        GET /search?q=
│   ├── teachers.js      GET /teachers, GET /teachers/:id/lessons
│   ├── enrolment.js     GET /enrolment/:lessonid
│   ├── auth.js          Sign-up, verify, resend, login, me, logout, forgot / reset password
│   └── admin.js         Admin dashboard API (stats, lessons, teachers, orders, users), admin login required
├── scripts/
│   ├── seed.js          Resets the database: 12 lessons and 4 teachers
│   └── create-admin.js  Creates/updates the admin account from ADMIN_EMAIL / ADMIN_PASSWORD
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
   PAYSTACK_SECRET_KEY=      # Paystack TEST secret key (sk_test_…), only needed for card payments
   PAYSTACK_CURRENCY=NGN
   GBP_TO_NGN=2000           # fixed test exchange rate: £1 = ₦2,000
   BREVO_BOOKING_TEMPLATE_ID= # optional Brevo template for the booking email
   ```
   In MongoDB Atlas, your IP address must be allowed under **Network Access**.
3. Fill the database with the starting lessons and teachers. **Warning:** this deletes and recreates all lessons and teachers. Existing orders are kept.
   ```
   npm run seed
   ```
4. Create the admin account. It uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`, so run it again whenever you change them:
   ```
   npm run create-admin
   ```
5. Start the server:
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
| POST | `/orders` | `{ "name": "Jane Doe", "phone": "07123456789", "lessonIDs": ["6560f1…", "6560f2…"], "spaces": [2, 1] }`. Login is optional: send `Authorization: Bearer <token>` to link the order to your account. Optional: `email`, `countryCode` (`"+44"`), `paymentReference` (from Paystack). Prices come from the database; each lesson must exist and have enough spaces (`400` otherwise). With `paymentReference` the payment is checked with Paystack (success, exact amount, currency, not used before → `409`). | `201` `{ "message": "Order created", "orderId": "6561a0…", "paymentStatus": "unpaid", "totalGBP": 280, "receiptKey": "…", "emailSent": false }` |
| GET | `/orders/:id/receipt?key=<receiptKey>` | — | The PDF receipt (`application/pdf`). `404` if the key is wrong. |
| POST | `/payments/initialize` | `{ "name": "Jane Doe", "phone": "07123456789", "email": "jane@example.com", "lessonIDs": ["6560f1…"], "spaces": [2] }` | `{ "accessCode": "…", "reference": "…", "totalGBP": 200, "amountCharged": 400000, "currency": "NGN" }` |
| GET | `/search?q=term` | — | Lessons whose topic, location, price or space contains `term` (ignores case). An empty `q` returns all lessons. `[ { "_id": "6560f1…", "topic": "Maths", … } ]` |
| GET | `/teachers` | — | `[ { "_id": "6560f9…", "firstName": "Sarah", "lastName": "Ahmed", "lessonIDs": ["6560f1…", …] }, … ]` |
| GET | `/teachers/:id/lessons` | — | The teacher's lessons: `[ { "_id": "6560f1…", "topic": "Maths", … }, … ]` |
| GET | `/enrolment/:lessonid` | — | `{ "lessonId": "6560f1…", "topic": "Maths", "enrolled": 7 }` |
| POST | `/auth/signup` | `{ "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com", "password": "abcdefg1" }` | `201` `{ "message": "Account created. We sent a 6-digit code to your email.", "email": "jane@example.com" }` (`409` if the email is taken) |
| POST | `/auth/verify-email` | `{ "email": "jane@example.com", "code": "123456" }` | `{ "message": "Email verified. You can now log in." }` |
| POST | `/auth/resend-otp` | `{ "email": "jane@example.com", "purpose": "verify" }` (or `"reset"`) | `{ "message": "If this email needs a code, we have sent a new one." }` (`429` if asked again within 60 s) |
| POST | `/auth/login` | `{ "email": "jane@example.com", "password": "abcdefg1" }` | `{ "token": "3f9a1c…", "user": { "_id": "…", "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com", "role": "user" } }` (`401` wrong details, `403` `{ "needsVerification": true }` if the email isn't verified) |
| GET | `/auth/me` | — (needs `Authorization: Bearer <token>`) | `{ "user": { "_id": "…", "firstName": "Jane", … } }` |
| POST | `/auth/logout` | — (needs `Authorization: Bearer <token>`) | `{ "message": "Logged out" }` |
| POST | `/auth/forgot-password` | `{ "email": "jane@example.com" }` | `{ "message": "If an account exists for this email, we have sent a reset code." }` |
| POST | `/auth/reset-password` | `{ "email": "jane@example.com", "code": "123456", "newPassword": "newpass99" }` | `{ "message": "Password changed. Please log in with your new password." }` |

`GET /lessons`, `PUT /lessons/:id` and `POST /orders` are the marked coursework routes. They're deliberately public (no login needed) and are demonstrated in Postman.

**Admin routes.** Every `/admin` route needs `Authorization: Bearer <token>` from an account with `role: "admin"`. Without a token you get `401`; a normal user gets `403`.

| Method | Path | Body | Example response |
|---|---|---|---|
| GET | `/admin/stats` | — | `{ "lessons": 12, "orders": 5, "users": 3, "spacesBooked": 9, "revenue": 870 }` |
| POST | `/admin/lessons` | `{ "topic": "Chess", "location": "Hendon", "price": 60, "space": 5, "icon": "fa-solid fa-chess", "image": "chess.png" }` (`image` optional) | `201` `{ "message": "Lesson created", "lessonId": "…" }` |
| PUT | `/admin/lessons/:id` | Any of the lesson fields above (validated), e.g. `{ "price": 65 }` | `{ "message": "Lesson updated", "modified": 1 }` |
| DELETE | `/admin/lessons/:id` | — | `{ "message": "Lesson deleted" }` (also removed from teachers' `lessonIDs`) |
| GET | `/admin/teachers` | — | `[ { "_id": "…", "firstName": "Sarah", "lastName": "Ahmed", "lessonIDs": ["…"] }, … ]` |
| GET | `/admin/teachers/:id` | — | `{ "_id": "…", "firstName": "Sarah", … }` |
| POST | `/admin/teachers` | `{ "firstName": "Tom", "lastName": "Wilson", "lessonIDs": ["6560f1…"] }` | `201` `{ "message": "Teacher created", "teacherId": "…" }` |
| PUT | `/admin/teachers/:id` | Any of `firstName`, `lastName`, `lessonIDs` (`lessonIDs` replaces the whole list) | `{ "message": "Teacher updated", "modified": 1 }` |
| DELETE | `/admin/teachers/:id` | — | `{ "message": "Teacher deleted" }` |
| GET | `/admin/orders` | — | Newest first: `[ { "_id": "…", "name": "Jane Doe", …, "lessons": [ { "lessonId": "…", "topic": "Maths", "spaces": 2 } ] } ]` |
| GET | `/admin/users` | — | `[ { "_id": "…", "firstName": "Jane", "email": "…", "role": "user", "isVerified": true, … } ]` (no password hashes) |
| PATCH | `/admin/users/:id/role` | `{ "role": "admin" }` or `{ "role": "user" }` | `{ "message": "Role updated", "role": "admin" }` |
| DELETE | `/admin/users/:id` | — | `{ "message": "User deleted" }` (also logs them out). An admin can't delete or demote their own account. |

**Errors**

| Status | When | Example response |
|---|---|---|
| `400` | Invalid id, failed order validation, nothing to update, broken JSON | `{ "error": "Phone must contain numbers only" }` |
| `401` | Wrong email/password, or a missing/expired token | `{ "error": "Please log in" }` |
| `403` | Email not verified yet, or not an admin | `{ "error": "Admins only" }` |
| `404` | No lesson/teacher with that id, or the route doesn't exist | `{ "error": "Route not found" }` |
| `409` | Sign-up with an email that already has an account | `{ "error": "An account with this email already exists" }` |
| `429` | A new code was asked for within 60 seconds | `{ "error": "Please wait 60 seconds before asking for another code" }` |
| `500` | Database or server error | `{ "error": "…" }` |

**Order validation:** `name` must be letters and spaces only, and `phone` must be digits only. `lessonIDs` and `spaces` must be non-empty arrays of the same length. Every lesson id must be a valid `_id`, and every space must be a positive whole number. `spaces[i]` is the number of spaces booked for `lessonIDs[i]`.

## AI use

AI tools (Claude) helped draft parts of this back-end and this README. I reviewed, ran and tested all the code, and I can explain every line. The code follows the patterns taught in the CST3144 labs and workshops.
