const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    courseId: { type: String, required: true },
    title: { type: String, required: true },
    desc: { type: String, required: true },
    url: { type: String, required: true },
    videoPublicId: { type: String, default: '' }, // Cloudinary public_id, needed to delete the file later
    duration: { type: Number, required: true },
    gate: { type: String, enum: ['free', 'paid'], default: 'paid' },
    creatorId: { type: String, required: true },
    creatorName: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Lecture', lectureSchema);
