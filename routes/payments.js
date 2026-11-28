// routes/payments.js — all the routes that start with /payments.
// server.js mounts this file with app.use('/payments', paymentsRouter).
//
// HOW A PAID ORDER WORKS (Paystack, TEST mode)
// 1. Browser → POST /payments/initialize with the details and the cart.
//    The server prices the cart FROM THE DATABASE and asks Paystack to start a payment.
//    The browser gets back an accessCode and a reference.
// 2. The browser opens Paystack's pop-up with the accessCode, and the customer pays
//    with a Paystack TEST card (no real money).
// 3. Browser → POST /orders with the same details + paymentReference.
//    The server asks Paystack whether that payment really succeeded, for the right
//    amount, before saving the order as "paid" (see routes/orders.js).

const express = require('express');
const router = express.Router();
const { checkOrderBody } = require('../utils/orderChecks');      // same field checks as /orders
const { calculateOrder } = require('../utils/pricing');          // real prices from the DB
const { initializeTransaction } = require('../utils/paystack');  // starts a Paystack payment
const { getUserFromToken } = require('../middleware/auth');      // reads the login token (if any)

// Paystack needs an email on every payment, but the brief's checkout only asks for a name
// and a phone. When the customer leaves the email empty, this stand-in address is given to
// Paystack instead. example.com is reserved for examples, so nothing is ever delivered there.
const GUEST_EMAIL = process.env.PAYSTACK_GUEST_EMAIL || 'guest@example.com';

// POST /payments/initialize
// Body: { name, phone, lessonIDs: [...], spaces: [...] }   (email and countryCode optional)
// Answer: { accessCode, reference, totalGBP, amountCharged, currency }
//
// LOGIN IS OPTIONAL (like POST /orders): guests can pay. If a valid token is sent, the
// user's id goes into the Paystack metadata, and POST /orders links the order to the account.
router.post('/initialize', async (req, res) => {
    const body = req.body || {};
    const { name, phone, email, lessonIDs, spaces } = body;

    // 1. Same checks as POST /orders (name letters only, phone digits only, email optional)
    const problem = checkOrderBody(body, false);
    if (problem) {
        return res.status(400).json({ error: problem });
    }

    try {
        // 2. The real total, worked out on the server (400 if a lesson is missing or full)
        const pricing = await calculateOrder(lessonIDs, spaces);

        // Logged in? { user, token } or null for a guest (only used for the metadata)
        const login = await getUserFromToken(req);

        // 3. Ask Paystack to start a payment for exactly that amount.
        //    metadata is saved by Paystack with the payment, so it shows in the Paystack
        //    dashboard what the payment was for.
        const payment = await initializeTransaction({
            email: email || GUEST_EMAIL,         // the customer's email, or the stand-in
            amountInSubunits: pricing.amountInSubunits,
            currency: pricing.currency,
            metadata: { name, phone, lessonIDs, spaces, userId: login ? String(login.user._id) : null }
        });

        res.json({
            accessCode: payment.access_code,    // the browser opens the pop-up with this
            reference: payment.reference,       // sent back later with POST /orders
            totalGBP: pricing.totalGBP,         // e.g. 120 (pounds)
            amountCharged: pricing.amountCharged, // e.g. 240000 (naira, test rate)
            currency: pricing.currency          // e.g. "NGN"
        });
    } catch (err) {
        // 400 from calculateOrder (bad cart); anything else (e.g. Paystack down, key
        // missing) is a server-side problem → 502 "Bad Gateway" = another service failed
        res.status(err.status || 502).json({ error: err.message });
    }
});

module.exports = router;
