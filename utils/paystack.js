// utils/paystack.js — talks to Paystack (the card payment company) in TEST mode.
//
// No Paystack npm package: Paystack has a normal HTTPS API, so we call it with
// fetch(), which is built into Node 18+ (the same way utils/email.js calls Brevo).
//
// TEST mode: with a test secret key (it starts with "sk_test_") Paystack only accepts
// its test cards, and NO real money is ever taken.
//
// The SECRET key stays on the server (in .env). It must never be sent to the browser:
// anyone holding it could create or check payments on my account.

const PAYSTACK_URL = 'https://api.paystack.co';   // the start of every Paystack address

// The headers every Paystack request needs
function paystackHeaders() {
    // Fail with a clear message if the key is missing from .env
    if (!process.env.PAYSTACK_SECRET_KEY) {
        throw new Error('Payments are not set up: PAYSTACK_SECRET_KEY is missing from .env');
    }
    return {
        Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY,  // proves it's my account
        'Content-Type': 'application/json'                           // we send JSON
    };
}

// initializeTransaction — tells Paystack "a customer is about to pay this amount".
// Paystack answers with:
//   access_code: given to the browser, which opens Paystack's payment pop-up with it
//   reference:   the payment's unique id; we use it later to check the payment
async function initializeTransaction({ email, amountInSubunits, currency, metadata }) {
    const response = await fetch(PAYSTACK_URL + '/transaction/initialize', {
        method: 'POST',
        headers: paystackHeaders(),
        body: JSON.stringify({
            email: email,                  // Paystack needs the payer's email
            amount: amountInSubunits,      // in SUBUNITS (kobo for NGN), see utils/pricing.js
            currency: currency,            // e.g. "NGN"
            metadata: metadata             // extra info saved with the payment (name, lessons…)
        })
    });

    // Paystack always answers with JSON like { status: true/false, message, data }
    const result = await response.json();
    if (!response.ok || !result.status) {
        throw new Error('Paystack could not start the payment: ' + (result.message || response.status));
    }

    return {
        access_code: result.data.access_code,
        reference: result.data.reference
    };
}

// verifyTransaction — asks Paystack what REALLY happened to a payment.
// Returns Paystack's "data" object, which includes:
//   status ("success", "failed", "abandoned"…), amount (in subunits), currency, reference, paid_at
async function verifyTransaction(reference) {
    // encodeURIComponent makes the reference safe to put in a URL
    const response = await fetch(PAYSTACK_URL + '/transaction/verify/' + encodeURIComponent(reference), {
        method: 'GET',
        headers: paystackHeaders()
    });

    const result = await response.json();
    if (!response.ok || !result.status) {
        throw new Error('Paystack could not find that payment: ' + (result.message || response.status));
    }
    return result.data;
}

module.exports = { initializeTransaction, verifyTransaction };
