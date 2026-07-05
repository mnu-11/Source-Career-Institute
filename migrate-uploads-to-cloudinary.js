// One-time migration: uploads whatever is still sitting in your local /uploads
// folder (from before you switched to Cloudinary) up to Cloudinary, then updates
// the matching course/lecture/resource records in MongoDB with the new URLs.
//
// Run this AFTER you've already run `npm run migrate` (db.json -> MongoDB) and
// AFTER you've filled in your Cloudinary credentials in .env.
//
//   node migrate-uploads-to-cloudinary.js
//
// Safe to run more than once — it skips any record whose URL already points to
// Cloudinary (starts with "http"), so it only touches leftover local paths like
// "/uploads/videos/xyz.mp4".

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { cloudinary } = require('./config/cloudinary');

const Course = require('./models/Course');
const Lecture = require('./models/Lecture');
const Resource = require('./models/Resource');

function uploadLocalFile(localPath, folder, resourceType) {
    return cloudinary.uploader.upload(localPath, {
        folder,
        resource_type: resourceType
    });
}

async function migrateUploads() {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set. Add it to your .env file first.');
        process.exit(1);
    }
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        console.error('Cloudinary credentials are not set. Add them to your .env file first.');
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected.');

    let movedCount = 0;
    let skippedCount = 0;
    let missingCount = 0;

    // Courses (thumbnails)
    const courses = await Course.find();
    for (const course of courses) {
        if (!course.image || course.image.startsWith('http')) {
            skippedCount++;
            continue;
        }
        const localPath = path.join(__dirname, course.image.replace(/^\//, ''));
        if (!fs.existsSync(localPath)) {
            console.warn(`Missing local file for course "${course.title}": ${localPath}`);
            missingCount++;
            continue;
        }
        const result = await uploadLocalFile(localPath, 'edupay/thumbnails', 'image');
        course.image = result.secure_url;
        course.imagePublicId = result.public_id;
        await course.save();
        movedCount++;
        console.log(`Uploaded thumbnail for course "${course.title}"`);
    }

    // Lectures (videos)
    const lectures = await Lecture.find();
    for (const lecture of lectures) {
        if (!lecture.url || lecture.url.startsWith('http')) {
            skippedCount++;
            continue;
        }
        const localPath = path.join(__dirname, lecture.url.replace(/^\//, ''));
        if (!fs.existsSync(localPath)) {
            console.warn(`Missing local file for lecture "${lecture.title}": ${localPath}`);
            missingCount++;
            continue;
        }
        const result = await uploadLocalFile(localPath, 'edupay/videos', 'video');
        lecture.url = result.secure_url;
        lecture.videoPublicId = result.public_id;
        await lecture.save();
        movedCount++;
        console.log(`Uploaded video for lecture "${lecture.title}"`);
    }

    // Resources (PDFs etc.)
    const resources = await Resource.find();
    for (const resource of resources) {
        if (!resource.url || resource.url.startsWith('http')) {
            skippedCount++;
            continue;
        }
        const localPath = path.join(__dirname, resource.url.replace(/^\//, ''));
        if (!fs.existsSync(localPath)) {
            console.warn(`Missing local file for resource "${resource.title}": ${localPath}`);
            missingCount++;
            continue;
        }
        const result = await uploadLocalFile(localPath, 'edupay/resources', 'raw');
        resource.url = result.secure_url;
        resource.docPublicId = result.public_id;
        await resource.save();
        movedCount++;
        console.log(`Uploaded document for resource "${resource.title}"`);
    }

    console.log('----------------------------------------------------');
    console.log(`Done. Uploaded: ${movedCount}, already on Cloudinary: ${skippedCount}, missing locally: ${missingCount}`);
    if (missingCount > 0) {
        console.log('Records with missing local files were left unchanged — check the warnings above.');
    }
    process.exit(0);
}

migrateUploads().catch(err => {
    console.error('Upload migration failed:', err);
    process.exit(1);
});
