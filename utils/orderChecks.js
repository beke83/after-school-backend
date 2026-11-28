// utils/orderChecks.js — the checks shared by POST /orders and POST /payments/initialize.
// Both routes receive the same customer details and cart, so the rules live here once
// instead of being copied into two files.
//
// checkOrderBody(body, emailRequired) returns an error message (text) if something is
// wrong, or null if everything is fine. The route then sends the message with a 400.

const NAME_PATTERN = /^[A-Za-z\s]+$/;                 // letters and spaces only
const PHONE_PATTERN = /^[0-9]+$/;                     // digits only
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;   // something@something.something
const COUNTRY_CODE_PATTERN = /^\+[0-9]{1,4}$/;        // "+" then 1 to 4 digits, e.g. +44
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;        // a MongoDB _id: 24 hex characters

function checkOrderBody(body, emailRequired) {
    const { name, email, countryCode, phone, lessonIDs, spaces } = body;

    // name: letters and spaces only (and not empty)
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
        return 'Name must contain letters and spaces only';
    }

    // phone: numbers only (and not empty)
    if (typeof phone !== 'string' || !PHONE_PATTERN.test(phone)) {
        return 'Phone must contain numbers only';
    }

    // email: optional everywhere now (the brief's checkout only needs name + phone);
    // emailRequired is kept so a route could still insist on one.
    // If it IS sent, it must look like an email.
    if (email === undefined) {
        if (emailRequired) return 'Email is required';
    } else if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
        return 'Email must be a valid email address';
    }

    // countryCode: optional, e.g. "+44"
    if (countryCode !== undefined && (typeof countryCode !== 'string' || !COUNTRY_CODE_PATTERN.test(countryCode))) {
        return 'Country code must look like +44';
    }

    // lessonIDs and spaces: both must be arrays with at least one item
    if (!Array.isArray(lessonIDs) || !Array.isArray(spaces) || lessonIDs.length === 0) {
        return 'lessonIDs and spaces must be non-empty arrays';
    }

    // one "spaces" number for every lesson, so the lengths must match
    if (lessonIDs.length !== spaces.length) {
        return 'lessonIDs and spaces must be the same length';
    }

    // every lessonID must look like a MongoDB _id
    for (const id of lessonIDs) {
        if (typeof id !== 'string' || !OBJECT_ID_PATTERN.test(id)) {
            return 'Each lessonID must be a valid lesson _id';
        }
    }

    // every spaces value must be a whole number bigger than 0 (1, 2, 3...)
    for (const s of spaces) {
        if (!Number.isInteger(s) || s <= 0) {
            return 'Each spaces value must be a positive whole number';
        }
    }

    return null;   // no problems found
}

module.exports = { checkOrderBody, OBJECT_ID_PATTERN };
