// routes/orders.js — all the routes that start with /orders.
// server.js mounts this file with app.use('/orders', ordersRouter),
// so '/' in this file means '/orders' in the browser.

const express = require('express');      // load Express
const router = express.Router();         // a mini app that only holds routes
const crypto = require('crypto');        // built into Node: used for the random receipt key
const { getDB } = require('../db');      // our helper that gives us the connected database
const { ObjectId } = require('mongodb'); // MongoDB's id type, used for the lessons' _id
const { getUserFromToken, requireAuth } = require('../middleware/auth'); // reads the login token
const { checkOrderBody, OBJECT_ID_PATTERN } = require('../utils/orderChecks'); // shared field checks
const { calculateOrder } = require('../utils/pricing');        // real prices from the DB
const { verifyTransaction } = require('../utils/paystack');    // asks Paystack about a payment
const { createReceiptPdf } = require('../utils/receipt');      // builds the PDF receipt
const { sendTemplateEmail } = require('../utils/email');       // sends the confirmation email

// Why validate here when the front-end already checks the form?
// - The front-end check is for the USER: it gives instant feedback before sending.
// - The back-end check is for SAFETY: anyone can skip the front-end and send a
//   request straight to the API (e.g. with Postman), or turn off JavaScript.
//   The server is the only place we fully control, so it must never trust the data.

// POST /orders — save a new order
// Minimal body (the marked route, e.g. from Postman):
//   { name, phone, lessonIDs: [...], spaces: [...] }
// Optional extras from the checkout form:
//   email, countryCode (e.g. "+44"), paymentReference (from Paystack, after paying)
// The two arrays go together by position: spaces[i] is the number of spaces
// booked for lessonIDs[i]. Example: lessonIDs ['A', 'B'], spaces [2, 1]
// means 2 spaces in lesson A and 1 space in lesson B.
//
// MARKED ROUTE: POST /orders is part of the coursework marking and is demonstrated
// in Postman, so it stays PUBLIC on purpose, and WITHOUT a paymentReference it still
// works: the order is just saved as paymentStatus "unpaid".
// LOGIN IS OPTIONAL HERE (guests can still order).
// If the request carries a valid "Authorization: Bearer <token>", we save the user's _id.
router.post('/', async (req, res) => {
    const body = req.body || {};
    const { name, email, countryCode, phone, lessonIDs, spaces, paymentReference } = body;

    // 1. Check every field (same rules as POST /payments/initialize; email optional here)
    const problem = checkOrderBody(body, false);
    if (problem) {
        return res.status(400).json({ error: problem });
    }

    // paymentReference is optional, but if sent it must be a short, plain piece of text
    if (paymentReference !== undefined &&
        (typeof paymentReference !== 'string' || !/^[A-Za-z0-9._=-]{1,100}$/.test(paymentReference))) {
        return res.status(400).json({ error: 'paymentReference is not valid' });
    }

    try {
        // 2. Work out the price from the DATABASE (never from the browser) and check
        //    each lesson exists and still has enough spaces. Throws with status 400 if not.
        const pricing = await calculateOrder(lessonIDs, spaces);

        // The order we're going to save. Start with the minimal fields…
        const order = {
            name: name,
            phone: phone,
            // The browser sends the ids as text, but in the database a lesson's _id is an
            // ObjectId. Converting them means the order stores the same type as the lessons.
            lessonIDs: lessonIDs.map(id => new ObjectId(id)),
            spaces: spaces,
            email: email || null,              // null when it wasn't sent (e.g. from Postman)
            countryCode: countryCode || null,  // e.g. "+44", or null when not sent
            // A COPY of what was bought, at today's prices. The receipt is rebuilt from this
            // later, so it stays correct even if the admin changes a price afterwards.
            items: pricing.items,
            totalGBP: pricing.totalGBP,
            // A random secret needed to download this order's receipt (see GET /:id/receipt)
            receiptKey: crypto.randomBytes(16).toString('hex'),
            createdAt: new Date()
        };

        // 3. Was it paid? Check the payment with Paystack ITSELF.
        if (paymentReference) {
            // CHECK A — the reference hasn't been used for an order already.
            // Why: without this, someone could pay ONCE and then send the same reference
            // again and again to get many orders for one payment (a "replay").
            // (The unique index on orders.paymentReference in db.js also blocks it, even
            //  if two requests arrive at the same moment — see the catch below.)
            const used = await getDB().collection('orders').findOne({ paymentReference: paymentReference });
            if (used) {
                return res.status(409).json({ error: 'This payment has already been used for an order' });
            }

            // Ask Paystack (server to server, with our SECRET key) what really happened.
            // Why: the browser saying "I paid" proves nothing — anyone can send
            // { paymentReference: "anything" } from Postman. Only Paystack knows the truth.
            let payment;
            try {
                payment = await verifyTransaction(paymentReference);
            } catch (err) {
                return res.status(400).json({ error: 'Payment could not be verified: ' + err.message });
            }

            // CHECK B — the payment actually succeeded.
            // Why: a reference also exists for a FAILED or ABANDONED payment (the pop-up
            // was closed). Accepting those would give a "fake success": a booking with no money.
            if (payment.status !== 'success') {
                return res.status(400).json({ error: 'The payment was not successful (' + payment.status + ')' });
            }

            // CHECK C — Paystack's answer is about THIS reference (a simple safety check).
            if (payment.reference !== paymentReference) {
                return res.status(400).json({ error: 'Payment reference does not match' });
            }

            // CHECK D — the amount paid is EXACTLY what this order costs.
            // Why: someone could pay for 1 cheap space, then send the reference with an
            // order for 5 expensive spaces. Paystack's amount is in subunits (kobo), so we
            // compare it with calculateOrder's amountInSubunits for THIS order.
            if (payment.amount !== pricing.amountInSubunits) {
                return res.status(400).json({ error: 'The amount paid does not match the order total' });
            }

            // CHECK E — the currency matches.
            // Why: 24,000,000 in NGN (kobo) and 24,000,000 in another currency are very
            // different amounts of money, so the number alone isn't enough.
            if (payment.currency !== pricing.currency) {
                return res.status(400).json({ error: 'The payment currency does not match' });
            }

            // All checks passed → save the payment details with the order
            order.paymentStatus = 'paid';
            order.paymentReference = paymentReference;
            order.amountCharged = pricing.amountCharged;   // e.g. 240000 (naira)
            order.currency = pricing.currency;              // e.g. "NGN"
            order.paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date();
        } else {
            // No payment sent: still a valid order (keeps the marked route working in Postman)
            order.paymentStatus = 'unpaid';
        }

        // 4. Logged in? getUserFromToken returns { user, token } or null (guest).
        const login = await getUserFromToken(req);
        order.userId = login ? login.user._id : null;

        // 5. Save it
        const result = await getDB().collection('orders').insertOne(order);
        order._id = result.insertedId;

        // 6. Email the confirmation with the PDF receipt (only if we have an email).
        // WHY AN EMAIL FAILURE DOESN'T BLOCK THE ORDER:
        // by now the order is saved (and maybe paid). If Brevo is down or the key is
        // wrong, answering "error" would make the customer think the booking failed and
        // try again — paying twice. So we log the problem, still answer 201, and say
        // emailSent: false. They can still download the receipt from the confirmation screen.
        let emailSent = false;
        if (order.email) {
            try {
                emailSent = await sendConfirmation(order);
            } catch (err) {
                console.error('Confirmation email failed for order ' + order._id + ': ' + err.message);
            }
        }

        res.status(201).json({                // 201 = "Created"
            message: 'Order created',
            orderId: order._id,               // the _id MongoDB gave the new order
            paymentStatus: order.paymentStatus,
            totalGBP: order.totalGBP,
            receiptKey: order.receiptKey,     // needed for GET /orders/:id/receipt
            emailSent: emailSent
        });
    } catch (err) {
        // 11000 = MongoDB "duplicate key": the unique index on paymentReference stopped
        // a second order with the same payment (two requests at the same moment).
        if (err.code === 11000) {
            return res.status(409).json({ error: 'This payment has already been used for an order' });
        }
        // calculateOrder's problems (unknown lesson, not enough spaces) carry status 400
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /orders/mine — the logged-in user's own orders, newest first.
// Used by the "My account" page (account.html).
// requireAuth runs first: no valid token → 401 "Please log in", and this never runs.
// The filter { userId: req.user._id } means a user can only ever see THEIR orders:
// the id comes from the session on the server, not from anything the browser sends.
router.get('/mine', requireAuth, async (req, res) => {
    try {
        const orders = await getDB().collection('orders')
            .find({ userId: req.user._id })     // only this user's orders
            .sort({ createdAt: -1 })             // -1 = newest first
            .toArray();                          // turn the results into a normal array

        // Private data: tell the browser not to keep a copy (someone else might use
        // this computer after the user logs out).
        res.set('Cache-Control', 'no-store');

        // Send only what the page shows. receiptKey is included because these are the
        // user's own orders: the page uses it for the "Download receipt" links.
        res.json(orders.map(order => ({
            _id: order._id,
            createdAt: order.createdAt,
            items: order.items || [],            // older orders (before prices were saved) have none
            totalGBP: order.totalGBP,
            paymentStatus: order.paymentStatus || 'unpaid',
            amountCharged: order.amountCharged,
            currency: order.currency,
            receiptKey: order.receiptKey
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /orders/:id/receipt?key=... — downloads the PDF receipt for one order.
// Used by the "Download receipt" button on the confirmation screen.
// The order's _id alone isn't secret enough (ids are partly based on the time, so they
// can be guessed), and a receipt shows a name, email and phone. So the request must
// also carry the random receiptKey that only the person who placed the order was given.
router.get('/:id/receipt', async (req, res) => {
    const id = req.params.id;
    const key = req.query.key;

    if (!OBJECT_ID_PATTERN.test(id) || typeof key !== 'string' || key === '') {
        return res.status(400).json({ error: 'A valid order id and key are needed' });
    }

    try {
        // Both must match: the right order AND its secret key
        const order = await getDB().collection('orders').findOne({ _id: new ObjectId(id), receiptKey: key });
        if (!order || !order.items) {
            return res.status(404).json({ error: 'Receipt not found' });
        }

        const pdf = await createReceiptPdf(order, order.items);   // a Buffer holding the PDF

        // Tell the browser it's a PDF, and suggest a file name for saving it
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', 'attachment; filename="Classbar-receipt-' + order._id + '.pdf"');
        res.send(pdf);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Builds the PDF and sends the booking email. Returns true if it was really sent.
async function sendConfirmation(order) {
    const pdf = await createReceiptPdf(order, order.items);

    return sendTemplateEmail({
        to: order.email,
        templateId: process.env.BREVO_BOOKING_TEMPLATE_ID,   // empty → simple built-in email
        params: {
            name: order.name,
            orderId: String(order._id),
            date: order.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
            items: order.items.map(item => ({
                topic: item.topic,
                location: item.location,
                spaces: item.spaces,
                price: '£' + item.price.toFixed(2),
                lineTotal: '£' + item.lineTotal.toFixed(2)
            })),
            total: '£' + order.totalGBP.toFixed(2),
            paymentStatus: order.paymentStatus === 'paid' ? 'PAID' : 'UNPAID'
        },
        attachments: [{
            name: 'Classbar-receipt-' + order._id + '.pdf',
            content: pdf.toString('base64')   // the PDF's bytes as base64 text (see utils/email.js)
        }]
    });
}

module.exports = router;                      // let server.js use this router
