const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    courseId: { type: String, required: true },
    title: { type: String, required: true },
    type: { type: String, required: true },
    size: { type: String, default: '0.0 KB' },
    url: { type: String, required: true },
    docPublicId: { type: String, default: '' }, // Cloudinary public_id, needed to delete the file later
    gate: { type: String, enum: ['free', 'paid'], default: 'paid' },
    creatorId: { type: String, required: true },
    creatorName: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Resource', resourceSchema);
