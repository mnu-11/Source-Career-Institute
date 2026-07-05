const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    channel: { type: String, required: true },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);
