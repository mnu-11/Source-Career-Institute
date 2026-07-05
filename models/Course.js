const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    desc: { type: String, required: true },
    price: { type: Number, required: true },
    originalPrice: { type: Number, required: true },
    image: { type: String, default: '/uploads/thumbnails/default.jpg' },
    imagePublicId: { type: String, default: '' }, // Cloudinary public_id, needed to delete the file later
    studentsCount: { type: Number, default: 0 },
    lecturesCount: { type: Number, default: 0 },
    rating: { type: Number, default: 5.0 },
    creatorId: { type: String, required: true },
    creatorName: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Course', courseSchema);
