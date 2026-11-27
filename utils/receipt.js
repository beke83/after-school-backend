// utils/receipt.js — builds the booking confirmation / receipt as a PDF file.
// Uses pdfkit, a library that draws a PDF page by page: we tell it "write this text
// here", "draw this rectangle there", and it produces the file.
//
// WHAT IS A BUFFER?
// A Buffer is Node's way of holding raw bytes (binary data) in memory — like a string,
// but for data that isn't text, such as a PDF or an image. We build the whole PDF into
// one Buffer, so we can attach it to an email AND send it as a download.

const PDFDocument = require('pdfkit');

// Brand colours (same as the website)
const RED = '#EF5350';
const YELLOW = '#F9D74A';
const GREEN = '#4ADE80';
const INK = '#111111';
const MUTED = '#71717A';
const LINE = '#E4E4E0';

// 12.5 → "£12.50"
function pounds(amount) {
    return '£' + Number(amount).toFixed(2);
}

// 240000 → "NGN 240,000.00".
// (The ₦ sign isn't in the PDF's built-in Helvetica font, so the currency code is used.)
function money(amount, currency) {
    return currency + ' ' + Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// createReceiptPdf(order, items) → a Promise that gives back the PDF as a Buffer.
//   order: the saved order document (_id, name, email, phone, totalGBP, paymentStatus…)
//   items: [{ topic, location, spaces, price, lineTotal }]
function createReceiptPdf(order, items) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });

        // pdfkit hands us the file in small pieces ("chunks") as it writes it.
        // We collect them in an array, and when it has finished ('end') we join them
        // into ONE Buffer and resolve the Promise with it.
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const left = 50;     // left margin
        const right = 545;   // right edge of the writing area (A4 is 595 points wide)

        // ----- Header: the logo bars (red, yellow, green) + the name -----
        doc.roundedRect(left, 62, 7, 12, 3).fill(RED);
        doc.roundedRect(left + 10, 55, 7, 19, 3).fill(YELLOW);
        doc.roundedRect(left + 20, 48, 7, 26, 3).fill(GREEN);
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('Classbar — After School', left + 36, 52);

        // ----- Title -----
        doc.font('Helvetica-Bold').fontSize(13).fillColor(INK)
           .text('BOOKING CONFIRMATION / RECEIPT', left, 110);

        // ----- Receipt number, date and customer -----
        const date = new Date(order.createdAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
        const phone = (order.countryCode ? order.countryCode + ' ' : '') + order.phone;

        doc.font('Helvetica').fontSize(10).fillColor(MUTED);
        doc.text('Receipt no.: ' + order._id, left, 140);
        doc.text('Date: ' + date);
        doc.moveDown(0.8);
        doc.fillColor(INK).font('Helvetica-Bold').text('Customer');
        doc.font('Helvetica').text(order.name);
        if (order.email) doc.text(order.email);
        doc.text(phone);

        // ----- Table of lessons -----
        // x position of each column
        const col = { lesson: left, location: 190, spaces: 330, unit: 390, total: 470 };
        let y = doc.y + 25;

        // Header row
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
        doc.text('Lesson', col.lesson, y);
        doc.text('Location', col.location, y);
        doc.text('Spaces', col.spaces, y);
        doc.text('Unit price', col.unit, y);
        doc.text('Line total', col.total, y, { width: right - col.total, align: 'right' });
        y += 18;
        doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();   // a thin line under it
        y += 8;

        // One row per lesson
        doc.font('Helvetica').fillColor(INK);
        for (const item of items) {
            doc.text(item.topic, col.lesson, y);
            doc.text(item.location, col.location, y);
            doc.text(String(item.spaces), col.spaces, y);
            doc.text(pounds(item.price), col.unit, y);
            doc.text(pounds(item.lineTotal), col.total, y, { width: right - col.total, align: 'right' });
            y += 20;
        }
        doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
        y += 12;

        // ----- Totals and payment -----
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text('Total', col.unit, y);
        doc.text(pounds(order.totalGBP), col.total, y, { width: right - col.total, align: 'right' });
        y += 22;

        doc.font('Helvetica').fontSize(10);
        if (order.amountCharged) {
            doc.text('Amount charged (test mode): ' + money(order.amountCharged, order.currency), left, y);
            y += 15;
        }
        if (order.paymentReference) {
            doc.text('Payment reference: ' + order.paymentReference, left, y);
            y += 15;
        }

        // Status: green PAID or red UNPAID
        const paid = order.paymentStatus === 'paid';
        doc.font('Helvetica-Bold').fillColor(paid ? '#16A34A' : '#B91C1C')
           .text('Status: ' + (paid ? 'PAID' : 'UNPAID'), left, y);

        // ----- Footer -----
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        doc.text('Test payment — no real money was taken.', left, 740, { width: right - left, align: 'center' });
        doc.text('Please bring this confirmation to your first lesson.', { width: right - left, align: 'center' });

        doc.end();   // finish the PDF → triggers 'end' above
    });
}

module.exports = { createReceiptPdf };
