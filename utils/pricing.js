// utils/pricing.js — works out what an order costs.
//
// WHY THE PRICES COME FROM THE DATABASE, NOT THE BROWSER
// The browser could send { lessonId, price: 1 } — anyone can edit a request in DevTools
// or Postman. If we trusted that price, a £100 lesson could be bought for £1.
// So the browser only says WHICH lessons and HOW MANY spaces; the server looks up the
// real price of each lesson in MongoDB and does the maths itself.
//
// WHAT "SUBUNITS" MEANS
// Payment companies count money in the SMALLEST unit of a currency, as a whole number,
// to avoid decimal rounding errors (0.1 + 0.2 is 0.30000000000000004 in JavaScript!).
//   GBP: 1 pound = 100 pence      → £12.50 is sent as 1250
//   NGN: 1 naira = 100 kobo       → ₦240,000.00 is sent as 24000000
// Paystack test mode works in NGN (Nigerian naira), so the £ total is converted to naira
// with a fixed TEST exchange rate (GBP_TO_NGN in .env), then × 100 to get kobo.

const { ObjectId } = require('mongodb');
const { getDB } = require('../db');

// The currency Paystack charges in, and the test exchange rate (both can be set in .env)
const CURRENCY = process.env.PAYSTACK_CURRENCY || 'NGN';
const GBP_TO_NGN = Number(process.env.GBP_TO_NGN) || 2000;   // e.g. £1 = ₦2,000 (test rate)

// calculateOrder(lessonIDs, spaces)
//   lessonIDs: ['A', 'B'] (text ids)    spaces: [2, 1]  (same positions)
// Returns { items, totalGBP, amountInSubunits, amountCharged, currency }.
// If something is wrong it throws an error with .status = 400, which the route sends back.
async function calculateOrder(lessonIDs, spaces) {
    // Each lesson may only appear once (use spaces to book more than one)
    if (new Set(lessonIDs).size !== lessonIDs.length) {
        throw clientError('Each lesson should appear only once in lessonIDs');
    }

    // Load all the lessons in the order with ONE query ($in = "any of these ids")
    const ids = lessonIDs.map(id => new ObjectId(id));
    const lessons = await getDB().collection('lessons').find({ _id: { $in: ids } }).toArray();

    const items = [];
    let totalGBP = 0;

    for (let i = 0; i < ids.length; i++) {
        // Find this lesson in the results (.equals compares two ObjectIds)
        const lesson = lessons.find(l => l._id.equals(ids[i]));
        if (!lesson) {
            throw clientError('Lesson ' + lessonIDs[i] + ' does not exist');
        }

        // Not enough spaces left in the class?
        if (spaces[i] > lesson.space) {
            throw clientError('Only ' + lesson.space + ' space(s) left in ' + lesson.topic);
        }

        const lineTotal = lesson.price * spaces[i];   // price from the DATABASE × spaces
        totalGBP += lineTotal;

        items.push({
            lessonId: lesson._id,
            topic: lesson.topic,
            location: lesson.location,
            price: lesson.price,
            spaces: spaces[i],
            lineTotal: lineTotal
        });
    }

    // £ → naira → kobo. Math.round makes sure it's a whole number (no fractions of a kobo).
    const amountInSubunits = Math.round(totalGBP * GBP_TO_NGN * 100);

    return {
        items,
        totalGBP,
        amountInSubunits,                       // what Paystack charges, e.g. 24000000 kobo
        amountCharged: amountInSubunits / 100,  // the same in naira, for showing, e.g. 240000
        currency: CURRENCY
    };
}

// An Error with an HTTP status attached, so routes can do res.status(err.status)
function clientError(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

module.exports = { calculateOrder };
