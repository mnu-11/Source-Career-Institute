const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true }, // stored as a bcrypt hash, never plain text
    role: { type: String, enum: ['admin', 'teacher', 'student'], default: 'student' },
    isTeacherApproved: { type: Boolean, default: false },
    enrolledCourses: { type: [String], default: [] },
    phone: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
