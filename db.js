const mongoose = require('mongoose');

async function connectDB() {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set. Add it to your .env file.');
        process.exit(1);
    }

    // Catches connection problems that happen AFTER the initial successful
    // connect (e.g. network blip) so they print clearly instead of crashing
    // the process with an unhandled 'error' event.
    mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error (post-connect):', err && err.stack ? err.stack : err);
    });

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected successfully.');
    } catch (err) {
        console.error('MongoDB connection error:', err && err.stack ? err.stack : err);
        process.exit(1);
    }
}

module.exports = connectDB;
