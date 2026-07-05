require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');

const connectDB = require('./db');
const { sendOtpEmail } = require('./utils/mailer');
const { cloudinary, storage } = require('./config/cloudinary');
const User = require('./models/User');
const Course = require('./models/Course');
const Lecture = require('./models/Lecture');
const Resource = require('./models/Resource');
const Order = require('./models/Order');
const Chat = require('./models/Chat');

const app = express();
const PORT = process.env.PORT || 3000;

// Catch anything that would otherwise print as an unhelpful "[object Object]"
// or crash silently, and log it with a real message + stack trace instead.
process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED PROMISE REJECTION:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
});

// Connect to MongoDB Atlas
connectDB();

// Enable CORS and parsing middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer now uploads straight to Cloudinary (see config/cloudinary.js) instead of
// local disk, so files survive restarts/redeploys on hosts with ephemeral storage.
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB max video size
    }
});

// Deletes a file from Cloudinary by its public_id. Safe to call with an empty/
// missing public_id (e.g. the default placeholder thumbnail) — it just skips.
async function deleteFromCloudinary(publicId, resourceType = 'image') {
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (err) {
        console.error(`Failed to delete Cloudinary file (${publicId}):`, err && err.stack ? err.stack : err);
    }
}

// Middleware: Verify user role permissions
function checkPermissions(roles = [], requireApproval = true) {
    return async (req, res, next) => {
        try {
            const userId = req.headers['x-user-id'];
            if (!userId) {
                return res.status(401).json({ error: "Unauthorized. Missing User ID header." });
            }

            const user = await User.findOne({ id: userId });

            if (!user) {
                return res.status(401).json({ error: "User profile not found in database." });
            }

            if (roles.length > 0 && !roles.includes(user.role)) {
                return res.status(403).json({ error: `Forbidden. Role '${user.role}' lacks permission.` });
            }

            if (user.role === 'teacher' && requireApproval && !user.isTeacherApproved) {
                return res.status(403).json({ error: "Forbidden. Your teacher account is pending approval." });
            }

            req.currentUser = user;
            next();
        } catch (err) {
            console.error(err && err.stack ? err.stack : err);
            return res.status(500).json({ error: "Server error while checking permissions." });
        }
    };
}

// Same idea as checkPermissions, but never blocks the request — it just
// figures out who (if anyone) is asking, so public listing endpoints like
// /api/lectures can decide what to actually reveal to *this* caller.
async function attachOptionalUser(req, res, next) {
    try {
        const userId = req.headers['x-user-id'];
        req.currentUser = userId ? await User.findOne({ id: userId }) : null;
    } catch (err) {
        req.currentUser = null;
    }
    next();
}

// Mirrors the frontend's hasCourseAccess() rule: admins and all teachers
// can see everything; students need to actually be enrolled.
function userHasCourseAccess(user, courseId) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'teacher') return true;
    return Array.isArray(user.enrolledCourses) && user.enrolledCourses.includes(courseId);
}

// Serve Frontend Static Files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/app.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.js'));
});
app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'styles.css'));
});

// Note: file uploads now live on Cloudinary and are served directly from Cloudinary's
// URLs (stored in course.image / lecture.url / resource.url) — no local /uploads
// static route is needed for new uploads. If you have old local files left over from
// before switching to Cloudinary, run migrate-uploads-to-cloudinary.js to move them.

// ==========================================
// AUTHENTICATION API
// ==========================================

// Restore session on page refresh (frontend stores just the user id locally)
app.get('/api/me', checkPermissions([], false), (req, res) => {
    return res.json({ user: req.currentUser });
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password, method, otp } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            return res.status(400).json({ error: "Account does not exist." });
        }

        if (method === 'otp') {
            if (!otp) {
                return res.status(400).json({ error: "OTP code is required." });
            }
            const record = req.app.locals[`otp_${email.toLowerCase()}`];
            if (!record || Date.now() > record.expiresAt) {
                delete req.app.locals[`otp_${email.toLowerCase()}`];
                return res.status(400).json({ error: "OTP has expired. Please request a new one." });
            }
            if (otp !== record.code) {
                return res.status(400).json({ error: "Invalid OTP verification code." });
            }
            delete req.app.locals[`otp_${email.toLowerCase()}`];
            return res.json({ message: "OTP login successful", user });
        } else {
            const passwordMatches = await bcrypt.compare(password, user.password);
            if (!passwordMatches) {
                return res.status(400).json({ error: "Invalid password credentials." });
            }
            return res.json({ message: "Password login successful", user });
        }
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error during login." });
    }
});

// Send Login/Register OTP Route
app.post('/api/auth/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: "Email is required." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store the code server-side only, with a 10-minute expiry. It is never
    // sent back in the API response — the only way to get it is the email.
    req.app.locals[`otp_${normalizedEmail}`] = {
        code: generatedOtp,
        expiresAt: Date.now() + 10 * 60 * 1000
    };

    try {
        await sendOtpEmail(normalizedEmail, generatedOtp);
        return res.json({ message: "Verification OTP code sent successfully." });
    } catch (err) {
        console.error('Failed to send OTP email:', err && err.stack ? err.stack : err);
        delete req.app.locals[`otp_${normalizedEmail}`];
        return res.status(500).json({ error: "Failed to send OTP email. Please check server email configuration." });
    }
});

// Register Route
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, role, otp } = req.body;
        const normalizedEmail = email.trim().toLowerCase();

        if (!otp) {
            return res.status(400).json({ error: "Verification code is required." });
        }
        const record = req.app.locals[`otp_${normalizedEmail}`];
        if (!record || Date.now() > record.expiresAt) {
            delete req.app.locals[`otp_${normalizedEmail}`];
            return res.status(400).json({ error: "Verification code has expired. Please request a new one." });
        }
        if (otp !== record.code) {
            return res.status(400).json({ error: "Invalid verification code." });
        }
        delete req.app.locals[`otp_${normalizedEmail}`];

        const emailExists = await User.findOne({ email: normalizedEmail });
        if (emailExists) {
            return res.status(400).json({ error: "Email already registered." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await User.create({
            id: `user-${Date.now()}`,
            name: name.trim(),
            email: normalizedEmail,
            password: hashedPassword,
            role: role || 'student',
            isTeacherApproved: role !== 'teacher',
            enrolledCourses: [],
            phone: ""
        });

        return res.status(201).json({ message: "Registration successful", user: newUser });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error during registration." });
    }
});

// Google Login Route
app.post('/api/auth/google-login', async (req, res) => {
    try {
        const { email, name } = req.body;
        if (!email || !name) {
            return res.status(400).json({ error: "Invalid Google credentials." });
        }

        let user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            const randomPassword = "google_oauth_bypass_" + Math.random().toString(36).substring(2, 8);
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            user = await User.create({
                id: `user-${Date.now()}`,
                name: name,
                email: email.toLowerCase(),
                password: hashedPassword,
                role: "student",
                isTeacherApproved: false,
                enrolledCourses: [],
                phone: ""
            });
        }

        return res.json({ message: "Google auth successful", user });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error during Google login." });
    }
});

// Update Profile
app.put('/api/profile', checkPermissions([], false), async (req, res) => {
    try {
        const { name, phone } = req.body;
        const user = await User.findOne({ id: req.currentUser.id });
        if (!user) {
            return res.status(400).json({ error: "User not found." });
        }

        user.name = name || user.name;
        user.phone = phone || user.phone;
        await user.save();

        return res.json({ message: "Profile updated successfully.", user });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error updating profile." });
    }
});

// Apply to be a Teacher
app.post('/api/profile/apply-teacher', checkPermissions(['student'], false), async (req, res) => {
    try {
        const user = await User.findOne({ id: req.currentUser.id });
        if (!user) {
            return res.status(400).json({ error: "User not found." });
        }

        user.role = 'teacher';
        user.isTeacherApproved = false;
        await user.save();

        return res.json({ message: "Application submitted.", user });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error submitting application." });
    }
});

// ==========================================
// COURSES API
// ==========================================

// Get All Courses
app.get('/api/courses', async (req, res) => {
    try {
        const courses = await Course.find();
        return res.json(courses);
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error fetching courses." });
    }
});

// Create Course (Approved Teachers/Admins only)
app.post('/api/courses', checkPermissions(['teacher', 'admin']), upload.single('thumbnail'), async (req, res) => {
    try {
        const { title, desc, price } = req.body;
        if (!title || !desc || !price) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        // req.file.path is the full Cloudinary secure URL when a file was uploaded
        const thumbnailPath = req.file
            ? req.file.path
            : 'https://placehold.co/600x400?text=Course+Thumbnail';
        const thumbnailPublicId = req.file ? req.file.filename : '';

        const newCourse = await Course.create({
            id: `course-${Date.now()}`,
            title: title.trim(),
            desc: desc.trim(),
            price: parseInt(price),
            originalPrice: parseInt(price) * 2,
            image: thumbnailPath,
            imagePublicId: thumbnailPublicId,
            studentsCount: 0,
            lecturesCount: 0,
            rating: 5.0,
            creatorId: req.currentUser.id,
            creatorName: req.currentUser.name
        });

        return res.status(201).json({ message: "Course created successfully.", course: newCourse });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error creating course." });
    }
});

// Update Course
app.put('/api/courses/:id', checkPermissions(['teacher', 'admin']), upload.single('thumbnail'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, desc, price } = req.body;

        const course = await Course.findOne({ id });
        if (!course) {
            return res.status(404).json({ error: "Course not found." });
        }

        if (course.creatorId !== req.currentUser.id && req.currentUser.role !== 'admin') {
            return res.status(403).json({ error: "Forbidden. You are not the creator of this course." });
        }

        course.title = title || course.title;
        course.desc = desc || course.desc;
        course.price = price ? parseInt(price) : course.price;
        course.originalPrice = price ? parseInt(price) * 2 : course.originalPrice;

        if (req.file) {
            await deleteFromCloudinary(course.imagePublicId, 'image');
            course.image = req.file.path;
            course.imagePublicId = req.file.filename;
        }

        await course.save();
        return res.json({ message: "Course updated successfully.", course });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error updating course." });
    }
});

// Delete Course
app.delete('/api/courses/:id', checkPermissions(['teacher', 'admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const course = await Course.findOne({ id });
        if (!course) {
            return res.status(404).json({ error: "Course not found." });
        }

        if (course.creatorId !== req.currentUser.id && req.currentUser.role !== 'admin') {
            return res.status(403).json({ error: "Forbidden. You do not own this course." });
        }

        // Clean up every file this course owns: its own thumbnail, plus every
        // lecture video and resource document that belongs to it.
        await deleteFromCloudinary(course.imagePublicId, 'image');

        const lecturesToDelete = await Lecture.find({ courseId: id });
        for (const lecture of lecturesToDelete) {
            await deleteFromCloudinary(lecture.videoPublicId, 'video');
        }

        const resourcesToDelete = await Resource.find({ courseId: id });
        for (const resource of resourcesToDelete) {
            await deleteFromCloudinary(resource.docPublicId, 'raw');
        }

        await Course.deleteOne({ id });
        await Lecture.deleteMany({ courseId: id });
        await Resource.deleteMany({ courseId: id });

        return res.json({ message: "Course and related content deleted." });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error deleting course." });
    }
});

// ==========================================
// LECTURES API
// ==========================================

// Get Lectures
app.get('/api/lectures', attachOptionalUser, async (req, res) => {
    try {
        const lectures = await Lecture.find();
        const sanitized = lectures.map(l => {
            const lect = l.toObject();
            const canView = lect.gate === 'free' || userHasCourseAccess(req.currentUser, lect.courseId);
            if (!canView) {
                // Keep the metadata (title, duration, gate) so the UI can still
                // show a locked entry, but never send the actual video file URL
                // to someone who hasn't purchased/unlocked this lecture.
                lect.url = null;
                lect.videoPublicId = undefined;
            }
            return lect;
        });
        return res.json(sanitized);
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error fetching lectures." });
    }
});

// Create Lecture (Approved Teachers/Admins only)
app.post('/api/lectures', checkPermissions(['teacher', 'admin']), upload.single('video'), async (req, res) => {
    try {
        const { courseId, title, desc, duration, gate } = req.body;
        if (!courseId || !title || !desc || !duration) {
            return res.status(400).json({ error: "Missing lecture fields." });
        }

        if (!req.file) {
            return res.status(400).json({ error: "Please upload a lecture video file." });
        }
        const videoPath = req.file.path; // Cloudinary secure URL
        const videoPublicId = req.file.filename; // Cloudinary public_id, needed to delete later

        // Cloudinary reports the real video duration (in seconds) in the upload
        // result for video resources. Trust that over the client-supplied value
        // whenever it's present, so duration is always accurate even if the
        // browser's auto-detect step was skipped or failed.
        const cloudinaryDurationSecs = req.file.duration;
        const finalDuration = (typeof cloudinaryDurationSecs === 'number' && cloudinaryDurationSecs > 0)
            ? Math.max(1, Math.round(cloudinaryDurationSecs / 60))
            : parseInt(duration);

        const newLecture = await Lecture.create({
            id: `lect-${Date.now()}`,
            courseId,
            title: title.trim(),
            desc: desc.trim(),
            url: videoPath,
            videoPublicId: videoPublicId,
            duration: finalDuration,
            gate: gate || 'paid',
            creatorId: req.currentUser.id,
            creatorName: req.currentUser.name
        });

        const lecturesCount = await Lecture.countDocuments({ courseId });
        await Course.updateOne({ id: courseId }, { lecturesCount });

        return res.status(201).json({ message: "Lecture uploaded successfully.", lecture: newLecture });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error creating lecture." });
    }
});

// Update Lecture
app.put('/api/lectures/:id', checkPermissions(['teacher', 'admin']), upload.single('video'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, desc, duration, gate } = req.body;

        const lecture = await Lecture.findOne({ id });
        if (!lecture) {
            return res.status(404).json({ error: "Lecture not found." });
        }

        if (lecture.creatorId !== req.currentUser.id && req.currentUser.role !== 'admin') {
            return res.status(403).json({ error: "Forbidden. Access denied." });
        }

        lecture.title = title || lecture.title;
        lecture.desc = desc || lecture.desc;
        lecture.duration = duration ? parseInt(duration) : lecture.duration;
        lecture.gate = gate || lecture.gate;

        if (req.file) {
            await deleteFromCloudinary(lecture.videoPublicId, 'video');
            lecture.url = req.file.path;
            lecture.videoPublicId = req.file.filename;

            // A new video was uploaded — prefer Cloudinary's real detected
            // duration over whatever was typed into the form.
            const cloudinaryDurationSecs = req.file.duration;
            if (typeof cloudinaryDurationSecs === 'number' && cloudinaryDurationSecs > 0) {
                lecture.duration = Math.max(1, Math.round(cloudinaryDurationSecs / 60));
            }
        }

        await lecture.save();
        return res.json({ message: "Lecture updated successfully.", lecture });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error updating lecture." });
    }
});

// Delete Lecture
app.delete('/api/lectures/:id', checkPermissions(['teacher', 'admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const lecture = await Lecture.findOne({ id });
        if (!lecture) {
            return res.status(404).json({ error: "Lecture not found." });
        }

        if (lecture.creatorId !== req.currentUser.id && req.currentUser.role !== 'admin') {
            return res.status(403).json({ error: "Forbidden." });
        }

        const courseId = lecture.courseId;
        await deleteFromCloudinary(lecture.videoPublicId, 'video');
        await Lecture.deleteOne({ id });

        const lecturesCount = await Lecture.countDocuments({ courseId });
        await Course.updateOne({ id: courseId }, { lecturesCount });

        return res.json({ message: "Lecture deleted." });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error deleting lecture." });
    }
});

// ==========================================
// RESOURCES API
// ==========================================

// Get Resources
app.get('/api/resources', attachOptionalUser, async (req, res) => {
    try {
        const resources = await Resource.find();
        const sanitized = resources.map(r => {
            const resource = r.toObject();
            const canView = resource.gate === 'free' || userHasCourseAccess(req.currentUser, resource.courseId);
            if (!canView) {
                resource.url = null;
                resource.docPublicId = undefined;
            }
            return resource;
        });
        return res.json(sanitized);
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error fetching resources." });
    }
});

// Upload Resource Document
app.post('/api/resources', checkPermissions(['teacher', 'admin']), upload.single('document'), async (req, res) => {
    try {
        const { courseId, title, type, gate } = req.body;
        if (!courseId || !title || !type) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        if (!req.file) {
            return res.status(400).json({ error: "Please select a PDF document file to upload." });
        }

        const fileSize = (req.file.size / (1024 * 1024)).toFixed(1) + " MB";
        const docPath = req.file.path; // Cloudinary secure URL
        const docPublicId = req.file.filename; // Cloudinary public_id, needed to delete later

        const newResource = await Resource.create({
            id: `res-${Date.now()}`,
            courseId,
            title: title.trim(),
            type,
            size: fileSize,
            url: docPath,
            docPublicId: docPublicId,
            gate: gate || 'paid',
            creatorId: req.currentUser.id,
            creatorName: req.currentUser.name
        });

        return res.status(201).json({ message: "Document uploaded successfully.", resource: newResource });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error uploading resource." });
    }
});

// Delete Resource
app.delete('/api/resources/:id', checkPermissions(['teacher', 'admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const resource = await Resource.findOne({ id });
        if (!resource) {
            return res.status(404).json({ error: "Document not found." });
        }

        if (resource.creatorId !== req.currentUser.id && req.currentUser.role !== 'admin') {
            return res.status(403).json({ error: "Forbidden." });
        }

        await deleteFromCloudinary(resource.docPublicId, 'raw');
        await Resource.deleteOne({ id });
        return res.json({ message: "Document deleted." });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error deleting resource." });
    }
});

// ==========================================
// USERS API (ADMIN CONTROL PANEL)
// ==========================================

// Get All Users (Admin only)
app.get('/api/users', checkPermissions(['admin']), async (req, res) => {
    try {
        const users = await User.find();
        return res.json(users);
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error fetching users." });
    }
});

// Lightweight public directory (name/role only) for chat member lists - any logged-in user
app.get('/api/users/directory', checkPermissions([], false), async (req, res) => {
    try {
        const users = await User.find();
        const directory = users.map(u => ({
            id: u.id,
            name: u.name,
            role: u.role,
            isTeacherApproved: u.isTeacherApproved
        }));
        return res.json(directory);
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error fetching directory." });
    }
});

// Update User role/status (Admin only)
app.put('/api/users/:id', checkPermissions(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, password, role, isTeacherApproved } = req.body;

        const user = await User.findOne({ id });
        if (!user) {
            return res.status(404).json({ error: "User account not found." });
        }

        user.name = name || user.name;
        user.email = email || user.email;
        user.phone = phone !== undefined ? phone : user.phone;
        if (password) {
            user.password = await bcrypt.hash(password, 10);
        }
        user.role = role || user.role;
        user.isTeacherApproved = isTeacherApproved !== undefined
            ? (isTeacherApproved === 'approved' || isTeacherApproved === true)
            : user.isTeacherApproved;

        await user.save();
        return res.json({ message: "User account details updated.", user });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error updating user." });
    }
});

// Delete User (Admin only)
app.delete('/api/users/:id', checkPermissions(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        await User.deleteOne({ id });
        return res.json({ message: "User account deleted." });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error deleting user." });
    }
});

// ==========================================
// ORDERS API (Razorpay Verification Ledger)
// ==========================================

// Get Orders — admins see every order, everyone else sees only their own
// (needed so students can see their own payment receipts)
app.get('/api/orders', checkPermissions([], false), async (req, res) => {
    try {
        const orders = req.currentUser.role === 'admin'
            ? await Order.find()
            : await Order.find({ userEmail: req.currentUser.email });
        return res.json(orders);
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error fetching orders." });
    }
});

// Send Payment Verification OTP Route
app.post('/api/payments/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: "Email is required." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    req.app.locals[`payment_otp_${normalizedEmail}`] = {
        code: generatedOtp,
        expiresAt: Date.now() + 10 * 60 * 1000
    };

    try {
        await sendOtpEmail(normalizedEmail, generatedOtp);
        return res.json({ message: "Payment verification code sent successfully." });
    } catch (err) {
        console.error('Failed to send payment OTP email:', err && err.stack ? err.stack : err);
        delete req.app.locals[`payment_otp_${normalizedEmail}`];
        return res.status(500).json({ error: "Failed to send verification email. Please check server email configuration." });
    }
});

// Create Order (Enrolled/Purchased)
app.post('/api/orders', checkPermissions([], false), async (req, res) => {
    try {
        const { courseId, email, otp } = req.body;
        const normalizedEmail = (email || req.currentUser.email).trim().toLowerCase();

        if (!otp) {
            return res.status(400).json({ error: "Payment verification code is required." });
        }
        const record = req.app.locals[`payment_otp_${normalizedEmail}`];
        if (!record || Date.now() > record.expiresAt) {
            delete req.app.locals[`payment_otp_${normalizedEmail}`];
            return res.status(400).json({ error: "Verification code has expired. Please request a new one." });
        }
        if (otp !== record.code) {
            return res.status(400).json({ error: "Invalid payment verification code." });
        }
        delete req.app.locals[`payment_otp_${normalizedEmail}`];

        const course = await Course.findOne({ id: courseId });
        if (!course) {
            return res.status(404).json({ error: "Course not found." });
        }

        const orderId = `pay_sim_${Math.floor(100000 + Math.random() * 900000)}`;
        const dateStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

        const newOrder = await Order.create({
            id: orderId,
            userEmail: req.currentUser.email,
            courseId: course.id,
            courseTitle: course.title,
            amountPaid: course.price,
            paymentGateway: "Razorpay 3D Secure OTP Server",
            status: "SUCCESS",
            date: dateStr
        });

        const user = await User.findOne({ id: req.currentUser.id });
        if (!user.enrolledCourses.includes(courseId)) {
            user.enrolledCourses.push(courseId);
            await user.save();
        }

        course.studentsCount += 1;
        await course.save();

        return res.json({
            message: "Order processed and course enrolled.",
            order: newOrder,
            enrolledCourses: user.enrolledCourses
        });
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error processing order." });
    }
});

// ==========================================
// CHAT ROOM API
// ==========================================

// Get messages for active channel
app.get('/api/chat/:channel', checkPermissions([], false), async (req, res) => {
    try {
        const { channel } = req.params;
        const messages = await Chat.find({ channel });
        return res.json(messages);
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error fetching chat messages." });
    }
});

// Send message to channel
app.post('/api/chat', checkPermissions([], false), async (req, res) => {
    try {
        const { channel, message } = req.body;
        if (!channel || !message) {
            return res.status(400).json({ error: "Channel and message text are required." });
        }

        const user = req.currentUser;

        const newMessage = await Chat.create({
            id: `msg-${Date.now()}`,
            channel,
            senderId: user.id,
            senderName: user.name,
            senderRole: user.role,
            message: message.trim(),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });

        if (channel.startsWith('doubt-solving')) {
            simulateTeacherResponse(channel, message.toLowerCase());
        }

        return res.status(201).json(newMessage);
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        return res.status(500).json({ error: "Server error sending message." });
    }
});

// Doubt solver simulator on server
function simulateTeacherResponse(channel, text) {
    let reply = '';
    let teacherName = 'Professor H.C. Verma';
    let teacherId = 'user-teacher';

    if (channel === 'doubt-solving-physics') {
        if (text.includes('kinematics') || text.includes('velocity') || text.includes('motion')) {
            reply = "In 2D projectile motion, resolve the velocity into horizontal (u cos θ) and vertical (u sin θ) components. Since horizontal acceleration is zero, horizontal range is simply (u cos θ) * flight time. Let me know if you need the equation for inclined planes!";
        } else if (text.includes('friction') || text.includes('force') || text.includes('constraint')) {
            reply = "Remember, friction always opposes relative motion between the surfaces in contact, not necessarily the motion itself! The maximum static friction force is μ_s * N. Always draw the Free Body Diagram (FBD) first.";
        } else if (text.includes('work') || text.includes('energy') || text.includes('conserv')) {
            reply = "The Work-Energy Theorem states that the work done by all forces (conservative, non-conservative, internal, and external) equals the change in kinetic energy of the system. Write it out: W_all = ΔK.";
        }
    } else if (channel === 'doubt-solving-chemistry') {
        teacherName = 'Dr. Walter Lewin';
        if (text.includes('sn1') || text.includes('sn2') || text.includes('substitut')) {
            reply = "SN1 reactions proceed via a carbocation intermediate and are favored by polar protic solvents (like water or alcohols). SN2 reactions are single-step concerted processes favored by polar aprotic solvents (like acetone or DMF) and require a strong nucleophile.";
        } else if (text.includes('elimin') || text.includes('e1') || text.includes('e2')) {
            reply = "For E2 eliminations, the leaving group and the beta-hydrogen must be anti-periplanar (180 degrees dihedral angle). This geometry allows proper overlap of the developing pi orbital.";
        }
    } else if (channel === 'doubt-solving-maths') {
        teacherName = 'Professor H.C. Verma';
        if (text.includes('limit') || text.includes('continuity') || text.includes('l\'hopital')) {
            reply = "If a limit evaluates to an indeterminate form like 0/0 or ∞/∞, ensure the functions are differentiable near the point before applying L'Hopital's Rule. For 1^∞ forms, use the formula: exp( limit [g(x) * (f(x) - 1)] ).";
        } else if (text.includes('integr') || text.includes('parts') || text.includes('deriv')) {
            reply = "For integration by parts, follow the ILATE rule (Inverse, Logarithmic, Algebraic, Trigonometric, Exponential) to select your 'u' function. Keep in mind King's Property: integral from a to b of f(x) equals integral of f(a+b-x).";
        }
    }

    if (reply) {
        setTimeout(async () => {
            try {
                await Chat.create({
                    id: `msg-${Date.now()}-reply`,
                    channel,
                    senderId: teacherId,
                    senderName: teacherName,
                    senderRole: 'teacher',
                    message: reply,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });
                console.log(`[MOCK TEACHER CHAT REPLY SENT] ${teacherName}: ${reply}`);
            } catch (err) {
                console.error('Error saving simulated teacher reply:', err);
            }
        }, 2200);
    }
}

// Start Server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`Source Carrier Institute Backend Server running...`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`====================================================`);
});