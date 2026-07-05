const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    userEmail: { type: String, required: true },
    courseId: { type: String, required: true },
    courseTitle: { type: String, required: true },
    amountPaid: { type: Number, required: true },
    paymentGateway: { type: String, default: 'Razorpay 3D Secure OTP Server' },
    status: { type: String, default: 'SUCCESS' },
    date: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
