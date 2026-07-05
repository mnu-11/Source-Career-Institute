// One-time migration: reads your existing db.json and inserts everything into MongoDB Atlas.
// Run this ONCE, after setting MONGO_URI in .env, and before switching server.js over.
//
//   node migrate.js
//
// It also hashes plaintext passwords with bcrypt while migrating, since db.json
// currently stores them in plain text.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

const User = require('./models/User');
const Course = require('./models/Course');
const Lecture = require('./models/Lecture');
const Resource = require('./models/Resource');
const Order = require('./models/Order');
const Chat = require('./models/Chat');

const DB_FILE = path.join(__dirname, 'db.json');

async function migrate() {
    if (!fs.existsSync(DB_FILE)) {
        console.error('db.json not found next to migrate.js. Place it in the project root first.');
        process.exit(1);
    }

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set. Add it to your .env file first.');
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected.');

    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const data = JSON.parse(raw);

    // Safety check: refuse to run if collections already have data, to avoid duplicates
    const existingUsers = await User.countDocuments();
    if (existingUsers > 0) {
        console.error(`Users collection already has ${existingUsers} documents. Aborting to avoid duplicate migration.`);
        console.error('If you really want to re-run this, clear the collections in Atlas first.');
        process.exit(1);
    }

    console.log(`Migrating ${data.users?.length || 0} users...`);
    for (const u of data.users || []) {
        const hashedPassword = await bcrypt.hash(u.password, 10);
        await User.create({ ...u, password: hashedPassword });
    }

    console.log(`Migrating ${data.courses?.length || 0} courses...`);
    for (const c of data.courses || []) {
        await Course.create(c);
    }

    console.log(`Migrating ${data.lectures?.length || 0} lectures...`);
    for (const l of data.lectures || []) {
        await Lecture.create(l);
    }

    console.log(`Migrating ${data.resources?.length || 0} resources...`);
    for (const r of data.resources || []) {
        await Resource.create(r);
    }

    console.log(`Migrating ${data.orders?.length || 0} orders...`);
    for (const o of data.orders || []) {
        await Order.create(o);
    }

    console.log(`Migrating ${data.chat?.length || 0} chat messages...`);
    for (const m of data.chat || []) {
        await Chat.create(m);
    }

    console.log('Migration complete. Verify your data in the Atlas Collections tab.');
    console.log('IMPORTANT: your uploaded videos/thumbnails/PDFs in /uploads were NOT touched by');
    console.log('this script — they still need to be moved to cloud storage separately if you plan');
    console.log('to deploy somewhere with an ephemeral filesystem.');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
