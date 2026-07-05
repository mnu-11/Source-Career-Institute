// Source Carrier Institute Application JavaScript

// ----------------------------------------------------
// 1. DATABASE INITIALIZATION & LOCALSTORAGE UTILITIES
// ----------------------------------------------------

const API_BASE = ''; // relative URLs, since frontend is served statically by server.js

// Uploads a FormData payload with real upload-percentage progress (fetch() has no
// reliable upload progress support across browsers, so we use XMLHttpRequest here).
// onProgress receives a number 0-100. Resolves with a fetch-Response-like object
// so existing calling code (checking res.ok / res.json()) keeps working unchanged.
function uploadWithProgress(url, method, formData, headers, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        Object.entries(headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };

        xhr.onload = () => {
            let data = {};
            try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (_) { /* non-JSON response */ }
            resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                json: async () => data
            });
        };

        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.send(formData);
    });
}

let dbCache = {
    users: [],
    courses: [],
    lectures: [],
    resources: [],
    orders: [],
    chat: []
};

async function syncWithBackend() {
    try {
        const resCourses = await fetch(`${API_BASE}/api/courses`);
        dbCache.courses = await resCourses.json();

        const authHeaders = state.currentUser ? { headers: { 'x-user-id': state.currentUser.id } } : {};

        const resLectures = await fetch(`${API_BASE}/api/lectures`, authHeaders);
        dbCache.lectures = await resLectures.json();

        const resResources = await fetch(`${API_BASE}/api/resources`, authHeaders);
        dbCache.resources = await resResources.json();

        if (state.currentUser) {
            // Everyone gets their own order history (admin gets all orders,
            // students/teachers get just their own — enforced server-side).
            const resOrders = await fetch(`${API_BASE}/api/orders`, {
                headers: { 'x-user-id': state.currentUser.id }
            });
            dbCache.orders = await resOrders.json();

            // Admin-only: full user database, for the admin panel.
            if (state.currentUser.role === 'admin') {
                const resUsers = await fetch(`${API_BASE}/api/users`, {
                    headers: { 'x-user-id': state.currentUser.id }
                });
                dbCache.users = await resUsers.json();
            }
        }
    } catch (err) {
        console.error("Error syncing cache with backend:", err);
    }
}

// ----------------------------------------------------
// SESSION PERSISTENCE (keeps the user logged in across page refreshes)
// ----------------------------------------------------
const SESSION_KEY = "aether_session_uid";

function startSession(user) {
    state.currentUser = user;
    try {
        localStorage.setItem(SESSION_KEY, user.id);
    } catch (err) {
        console.error("Could not persist session:", err);
    }
}

function clearSession() {
    state.currentUser = null;
    try {
        localStorage.removeItem(SESSION_KEY);
    } catch (err) {
        console.error("Could not clear session:", err);
    }
}

async function restoreSession() {
    let uid = null;
    try {
        uid = localStorage.getItem(SESSION_KEY);
    } catch (err) {
        return;
    }
    if (!uid) return;

    try {
        const res = await fetch(`${API_BASE}/api/me`, {
            headers: { "x-user-id": uid }
        });
        if (!res.ok) {
            clearSession();
            return;
        }
        const data = await res.json();
        state.currentUser = data.user;
    } catch (err) {
        console.error("Could not restore session:", err);
    }
}

// Data Loaders
function getFromDB(key) {
    if (key === "edu_courses") return dbCache.courses;
    if (key === "edu_lectures") return dbCache.lectures;
    if (key === "edu_resources") return dbCache.resources;
    if (key === "edu_users") return dbCache.users;
    if (key === "edu_orders") return dbCache.orders;
    return [];
}

// ----------------------------------------------------
// 2. STATE MANAGEMENT & SYSTEM GLOBAL VARIABLES
// ----------------------------------------------------

let state = {
    currentUser: null,
    activeView: "home-view",
    selectedCourse: null,
    selectedLecture: null,
    purchasingCourse: null,
    videoTimer: null,
    videoPlaying: false,
    videoTime: 0,
    videoDuration: 2700, // 45 minutes in seconds
    videoSpeed: 1.0,
    videoMuted: false,
    activeLectureTab: "notes-tab",
    authLoginMethod: "password", // "password" or "otp"
    pendingRegistration: null,
    
    // Chat state
    activeChatChannel: "physics-doubts",
    chatMessages: [],
    chatPollInterval: null,
    googlePendingEmail: null
};

// ----------------------------------------------------
// 3. UI ELEMENT REFERENCES
// ----------------------------------------------------

const elements = {
    // Navigation
    logoBtn: document.getElementById("logo-btn"),
    themeToggleBtn: document.getElementById("theme-toggle-btn"),
    navCourses: document.getElementById("nav-courses"),
    navDashboard: document.getElementById("nav-dashboard"),
    navAdmin: document.getElementById("nav-admin"),
    userDisplay: document.getElementById("user-display"),
    loginNavBtn: document.getElementById("login-nav-btn"),
    logoutBtn: document.getElementById("logout-btn"),

    // Views
    homeView: document.getElementById("home-view"),
    courseDetailsView: document.getElementById("course-details-view"),
    dashboardView: document.getElementById("dashboard-view"),
    lectureViewerView: document.getElementById("lecture-viewer-view"),
    adminView: document.getElementById("admin-view"),

    // Catalog & Detail DOM containers
    courseListContainer: document.getElementById("course-list-container"),
    courseDetailContainer: document.getElementById("course-detail-container"),
    enrolledCoursesContainer: document.getElementById("enrolled-courses-container"),
    studentOrdersTableBody: document.getElementById("student-orders-table-body"),
    profileName: document.getElementById("profile-name"),
    profileEmail: document.getElementById("profile-email"),
    profilePhone: document.getElementById("profile-phone"),
    profileEditForm: document.getElementById("profile-edit-form"),

    // View Navigation Buttons
    exploreBtn: document.getElementById("explore-btn"),
    exploreTarget: document.getElementById("explore-target"),
    backToCoursesBtn: document.getElementById("back-to-courses-btn"),
    backToDashboardBtn: document.getElementById("back-to-dashboard-btn"),

    // Auth Modal
    authModal: document.getElementById("auth-modal"),
    authModalClose: document.getElementById("auth-modal-close"),
    authModalTitle: document.getElementById("auth-modal-title"),
    authModalSubtitle: document.getElementById("auth-modal-subtitle"),
    authForm: document.getElementById("auth-form"),
    nameGroup: document.getElementById("name-group"),
    authName: document.getElementById("auth-name"),
    authEmail: document.getElementById("auth-email"),
    authPassword: document.getElementById("auth-password"),
    authSubmitBtn: document.getElementById("auth-submit-btn"),
    authTogglePrompt: document.getElementById("auth-toggle-prompt"),
    authToggleBtn: document.getElementById("auth-toggle-btn"),
    
    // Auth Tabs (Password vs OTP)
    authTabsContainer: document.getElementById("auth-tabs-container"),
    authPassTab: document.getElementById("auth-pass-tab"),
    authOtpTab: document.getElementById("auth-otp-tab"),
    authPasswordGroup: document.getElementById("auth-password-group"),
    authOtpGroup: document.getElementById("auth-otp-group"),
    authOtpInput: document.getElementById("auth-otp-input"),
    authSendOtpBtn: document.getElementById("auth-send-otp-btn"),

    // Razorpay Modal
    rzpModal: document.getElementById("rzp-modal"),
    rzpDueAmount: document.getElementById("rzp-due-amount"),
    rzpCourseTitle: document.getElementById("rzp-course-title"),
    rzpPaymentActionBtn: document.getElementById("rzp-payment-action-btn"),
    rzpUpiId: document.getElementById("rzp-upi-id"),
    
    // Razorpay Views
    rzpFormView: document.getElementById("rzp-form-view"),
    rzpProcessingView: document.getElementById("rzp-processing-view"),
    rzpProcessingTitle: document.getElementById("rzp-processing-title"),
    rzpProcessingSubtext: document.getElementById("rzp-processing-subtext"),
    rzpOtpView: document.getElementById("rzp-otp-view"),
    rzpOtpSubtext: document.getElementById("rzp-otp-subtext"),
    rzpOtpCodeInput: document.getElementById("rzp-otp-code-input"),
    rzpSubmitOtpBtn: document.getElementById("rzp-submit-otp-btn"),
    rzpCancelOtpBtn: document.getElementById("rzp-cancel-otp-btn"),
    rzpResendOtpBtn: document.getElementById("rzp-resend-otp-btn"),
    rzpSuccessView: document.getElementById("rzp-success-view"),
    rzpSuccessSubtext: document.getElementById("rzp-success-subtext"),
    rzpSuccessOrderId: document.getElementById("rzp-success-order-id"),
    rzpSuccessCourse: document.getElementById("rzp-success-course"),
    rzpSuccessAmount: document.getElementById("rzp-success-amount"),
    rzpSuccessContinueBtn: document.getElementById("rzp-success-continue-btn"),

    // Video Player DOM references
    lectureVideoEl: document.getElementById("lecture-video-el"),
    videoPlaceholderGraphic: document.getElementById("video-placeholder-graphic"),
    videoPlayPlaceholderBtn: document.getElementById("video-play-placeholder-btn"),
    videoPlayerMessage: document.getElementById("video-player-message"),
    videoPlayBtn: document.getElementById("video-play-btn"),
    videoMuteBtn: document.getElementById("video-mute-btn"),
    videoCurrentTime: document.getElementById("video-current-time"),
    videoDurationEl: document.getElementById("video-duration"),
    videoSpeedSelect: document.getElementById("video-speed"),
    videoFullscreenBtn: document.getElementById("video-fullscreen-btn"),
    videoSeekbar: document.getElementById("video-seekbar"),
    videoSeekbarFill: document.getElementById("video-seekbar-fill"),
    activeLectureTitle: document.getElementById("active-lecture-title"),
    activeLectureDesc: document.getElementById("active-lecture-desc"),
    notesTabContainer: document.getElementById("notes-tab"),
    dppsTabContainer: document.getElementById("dpps-tab"),
    lectureSidebarList: document.getElementById("lecture-sidebar-list"),

    // Admin panel elements
    adminCoursesTableBody: document.getElementById("admin-courses-table-body"),
    adminLecturesTableBody: document.getElementById("admin-lectures-table-body"),
    adminResourcesTableBody: document.getElementById("admin-resources-table-body"),
    adminUsersTableBody: document.getElementById("admin-users-table-body"),
    adminOrdersTableBody: document.getElementById("admin-orders-table-body"),
    adminCreateCourseBtn: document.getElementById("admin-create-course-btn"),
    adminCreateLectureBtn: document.getElementById("admin-create-lecture-btn"),
    adminCreateResourceBtn: document.getElementById("admin-create-resource-btn"),

    // Modals for admin creation
    courseFormModal: document.getElementById("course-form-modal"),
    courseModalClose: document.getElementById("course-modal-close"),
    adminCourseForm: document.getElementById("admin-course-form"),
    courseFormTitle: document.getElementById("course-form-title"),
    courseFormId: document.getElementById("course-form-id"),
    courseTitle: document.getElementById("course-title"),
    courseDesc: document.getElementById("course-desc"),
    coursePriceInput: document.getElementById("course-price-input"),
    courseImageCurrent: document.getElementById("course-image-current"),

    lectureFormModal: document.getElementById("lecture-form-modal"),
    lectureModalClose: document.getElementById("lecture-modal-close"),
    adminLectureForm: document.getElementById("admin-lecture-form"),
    lectureFormTitle: document.getElementById("lecture-form-title"),
    lectureFormId: document.getElementById("lecture-form-id"),
    lectureCourseSelect: document.getElementById("lecture-course-select"),
    lectureTitleInput: document.getElementById("lecture-title-input"),
    lectureDescInput: document.getElementById("lecture-desc-input"),
    lectureVideoCurrent: document.getElementById("lecture-video-current"),
    lectureDurationInput: document.getElementById("lecture-duration-input"),
    lectureGateSelect: document.getElementById("lecture-gate-select"),

    resourceFormModal: document.getElementById("resource-form-modal"),
    resourceModalClose: document.getElementById("resource-modal-close"),
    adminResourceForm: document.getElementById("admin-resource-form"),
    resourceFormTitle: document.getElementById("resource-form-title"),
    resourceFormId: document.getElementById("resource-form-id"),
    resourceCourseSelect: document.getElementById("resource-course-select"),
    resourceTitleInput: document.getElementById("resource-title-input"),
    resourceTypeSelect: document.getElementById("resource-type-select"),
    resourceFileCurrent: document.getElementById("resource-file-current"),
    resourceGateSelect: document.getElementById("resource-gate-select"),

    // Google Auth Elements
    googleAuthModal: document.getElementById("google-auth-modal"),
    googleAuthClose: document.getElementById("google-auth-close"),
    googleLoginBtn: document.getElementById("google-login-btn"),
    googleEmailView: document.getElementById("google-email-view"),
    googlePasswordView: document.getElementById("google-password-view"),
    googleEmailForm: document.getElementById("google-email-form"),
    googlePasswordForm: document.getElementById("google-password-form"),
    googleInputEmail: document.getElementById("google-input-email"),
    googleInputPassword: document.getElementById("google-input-password"),
    googleShowPassword: document.getElementById("google-show-password"),
    googleDisplayEmail: document.getElementById("google-display-email"),
    googleLoadingBar: document.getElementById("google-loading-bar"),
    googleCreateAccountBtn: document.getElementById("google-create-account-btn"),

    // Chat Interface Elements
    navChat: document.getElementById("nav-chat"),
    chatView: document.getElementById("chat-view"),
    chatChannelsList: document.getElementById("chat-channels-list"),
    chatActiveChannelName: document.getElementById("chat-active-channel-name"),
    chatOnlineCount: document.getElementById("chat-online-count"),
    chatMessagesContainer: document.getElementById("chat-messages-container"),
    chatMessageForm: document.getElementById("chat-message-form"),
    chatMessageInput: document.getElementById("chat-message-input"),
    chatInstructorsList: document.getElementById("chat-instructors-list"),
    chatStudentsList: document.getElementById("chat-students-list"),

    // File inputs
    courseImageFile: document.getElementById("course-image-file"),
    lectureVideoFile: document.getElementById("lecture-video-file"),
    resourceFile: document.getElementById("resource-file"),
    courseUploadProgressWrap: document.getElementById("course-upload-progress-wrap"),
    courseUploadProgressFill: document.getElementById("course-upload-progress-fill"),
    courseUploadProgressLabel: document.getElementById("course-upload-progress-label"),
    lectureUploadProgressWrap: document.getElementById("lecture-upload-progress-wrap"),
    lectureUploadProgressFill: document.getElementById("lecture-upload-progress-fill"),
    lectureUploadProgressLabel: document.getElementById("lecture-upload-progress-label"),
    resourceUploadProgressWrap: document.getElementById("resource-upload-progress-wrap"),
    resourceUploadProgressFill: document.getElementById("resource-upload-progress-fill"),
    resourceUploadProgressLabel: document.getElementById("resource-upload-progress-label"),

    // Register OTP Elements
    registerOtpModal: document.getElementById("register-otp-modal"),
    registerOtpClose: document.getElementById("register-otp-close"),
    registerOtpInput: document.getElementById("register-otp-input"),
    registerOtpSubmitBtn: document.getElementById("register-otp-submit-btn"),
    registerOtpResendBtn: document.getElementById("register-otp-resend-btn"),
    registerOtpEmailDisplay: document.getElementById("register-otp-email-display"),
    registerOtpForm: document.getElementById("register-otp-form"),

    // Account Role Elements
    roleGroup: document.getElementById("role-group"),
    authRole: document.getElementById("auth-role"),
    teacherPendingBanner: document.getElementById("teacher-pending-banner"),
    teacherApplicationSection: document.getElementById("teacher-application-section"),
    teacherStatusArea: document.getElementById("teacher-status-area"),

    // Admin User Modal Elements
    userFormModal: document.getElementById("user-form-modal"),
    userModalClose: document.getElementById("user-modal-close"),
    adminUserForm: document.getElementById("admin-user-form"),
    userFormTitle: document.getElementById("user-form-title"),
    userFormId: document.getElementById("user-form-id"),
    userNameInput: document.getElementById("user-name-input"),
    userEmailInput: document.getElementById("user-email-input"),
    userPhoneInput: document.getElementById("user-phone-input"),
    userPasswordInput: document.getElementById("user-password-input"),
    userRoleSelect: document.getElementById("user-role-select"),
    userApprovalGroup: document.getElementById("user-approval-group"),
    userApprovalSelect: document.getElementById("user-approval-select"),
    adminDeleteUserBtn: document.getElementById("admin-delete-user-btn"),

    // Notification toast
    notificationToast: document.getElementById("notification-toast"),
    toastIcon: document.getElementById("toast-icon"),
    toastMessage: document.getElementById("toast-message")
};

// ----------------------------------------------------
// 4. NOTIFICATION & HELPER UTILITIES
// ----------------------------------------------------

function showToast(message, type = "success") {
    elements.toastMessage.textContent = message;
    elements.notificationToast.className = ""; // clear all custom class definitions
    
    // Assign proper aesthetic styles
    if (type === "success") {
        elements.notificationToast.classList.add("toast-success");
        elements.toastIcon.className = "fa-solid fa-circle-check";
    } else if (type === "error") {
        elements.notificationToast.classList.add("toast-error");
        elements.toastIcon.className = "fa-solid fa-circle-xmark";
    } else {
        elements.notificationToast.classList.add("toast-info");
        elements.toastIcon.className = "fa-solid fa-circle-info";
    }

    elements.notificationToast.style.display = "flex";
    
    // Clear existing timer if any
    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
    }

    window.toastTimeout = setTimeout(() => {
        elements.notificationToast.style.display = "none";
    }, 4500);
}

// Convert seconds to HH:MM:SS format
function formatTime(secs) {
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const seconds = Math.floor(secs % 60);

    const pad = (num) => String(num).padStart(2, '0');
    
    if (hours > 0) {
        return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
}

// Check if user has purchase rights to the course
function hasCourseAccess(courseId) {
    if (!state.currentUser) return false;
    // Admins and all teachers can see every course's lectures/resources
    // without buying access — payment gating only applies to students.
    if (state.currentUser.role === "admin") return true;
    if (state.currentUser.role === "teacher") return true;
    return state.currentUser.enrolledCourses.includes(courseId);
}

// ----------------------------------------------------
// 5. VIEW NAVIGATION CONTROLLER
// ----------------------------------------------------

function switchView(viewId) {
    // Terminate video running states if exiting lecture view
    if (state.activeView === "lecture-viewer-view" && viewId !== "lecture-viewer-view") {
        if (elements.lectureVideoEl) {
            elements.lectureVideoEl.pause();
        }
    }

    // Hide active elements, reset focus
    const currentActive = document.querySelector(".view-section.active-view");
    if (currentActive) {
        currentActive.classList.remove("active-view");
    }

    const targetSection = document.getElementById(viewId);
    if (targetSection) {
        targetSection.classList.add("active-view");
        state.activeView = viewId;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Update navigation active states
    document.querySelectorAll("nav a").forEach(link => link.classList.remove("active"));
    
    if (viewId === "home-view") {
        elements.navCourses.classList.add("active");
    } else if (viewId === "dashboard-view") {
        elements.navDashboard.classList.add("active");
        renderDashboard();
    } else if (viewId === "admin-view") {
        elements.navAdmin.classList.add("active");
        renderAdminPanel();
    }
}

// Update authentication navbar items depending on auth session
function updateNavbar() {
    if (state.currentUser) {
        elements.loginNavBtn.style.display = "none";
        elements.logoutBtn.style.display = "inline-flex";
        
        elements.userDisplay.textContent = `Hi, ${state.currentUser.name.split(' ')[0]}`;
        elements.userDisplay.style.display = "inline-block";

        if (state.currentUser.role === "admin") {
            elements.navDashboard.style.display = "none";
            elements.navAdmin.style.display = "inline-block";
            elements.navAdmin.innerHTML = '<i class="fa-solid fa-user-shield"></i> Admin Panel';
        } else if (state.currentUser.role === "teacher" && state.currentUser.isTeacherApproved) {
            elements.navDashboard.style.display = "none";
            elements.navAdmin.style.display = "inline-block";
            elements.navAdmin.innerHTML = '<i class="fa-solid fa-chalkboard-user"></i> Teacher Panel';
        } else {
            elements.navDashboard.style.display = "inline-block";
            elements.navAdmin.style.display = "none";
        }
        elements.navChat.style.display = "inline-block";
    } else {
        elements.loginNavBtn.style.display = "inline-flex";
        elements.logoutBtn.style.display = "none";
        elements.userDisplay.style.display = "none";
        elements.navDashboard.style.display = "none";
        elements.navAdmin.style.display = "none";
        elements.navChat.style.display = "none";
    }
}

// ----------------------------------------------------
// 6. AUTHENTICATION & OTP REGISTRATION LOGIC
// ----------------------------------------------------

let isLoginMode = true;

function openAuthModal() {
    elements.authModal.classList.add("active-modal");
    setAuthMode(true);
}

function closeAuthModal() {
    elements.authModal.classList.remove("active-modal");
    elements.authForm.reset();
    setAuthLoginMethod("password");
}

function setAuthLoginMethod(method) {
    state.authLoginMethod = method;
    
    if (method === "password") {
        elements.authPassTab.classList.add("active");
        elements.authOtpTab.classList.remove("active");
        elements.authPasswordGroup.style.display = "block";
        elements.authPassword.setAttribute("required", "true");
        elements.authOtpGroup.style.display = "none";
        elements.authOtpInput.removeAttribute("required");
    } else {
        elements.authPassTab.classList.remove("active");
        elements.authOtpTab.classList.add("active");
        elements.authPasswordGroup.style.display = "none";
        elements.authPassword.removeAttribute("required");
        elements.authOtpGroup.style.display = "block";
        elements.authOtpInput.setAttribute("required", "true");
    }
}

function setAuthMode(isLogin) {
    isLoginMode = isLogin;
    if (isLoginMode) {
        elements.authModalTitle.textContent = "Sign In";
        elements.authModalSubtitle.textContent = "Access your course library instantly.";
        elements.nameGroup.style.display = "none";
        elements.authName.removeAttribute("required");
        elements.roleGroup.style.display = "none";
        elements.authSubmitBtn.textContent = "Login";
        elements.authTogglePrompt.innerHTML = 'Don\'t have an account? <span id="auth-toggle-btn">Sign Up</span>';
        elements.authTabsContainer.style.display = "flex"; // Show tab selector in Login Mode
        setAuthLoginMethod("password");
    } else {
        elements.authModalTitle.textContent = "Create Account";
        elements.authModalSubtitle.textContent = "Start tracking your learning journey today.";
        elements.nameGroup.style.display = "block";
        elements.authName.setAttribute("required", "true");
        elements.roleGroup.style.display = "block";
        elements.authSubmitBtn.textContent = "Sign Up";
        elements.authTogglePrompt.innerHTML = 'Already have an account? <span id="auth-toggle-btn">Sign In</span>';
        elements.authTabsContainer.style.display = "none"; // Hide tabs in Register Mode (forces password setup)
        
        // Ensure Password group is visible for signup
        elements.authPasswordGroup.style.display = "block";
        elements.authPassword.setAttribute("required", "true");
        elements.authOtpGroup.style.display = "none";
        elements.authOtpInput.removeAttribute("required");
    }

    // Bind event dynamic toggle button inside prompt
    document.getElementById("auth-toggle-btn").addEventListener("click", () => {
        setAuthMode(!isLoginMode);
    });
}

function isGmailAddress(email) {
    return email.trim().toLowerCase().endsWith("@gmail.com");
}

async function simulateSendAuthOTP() {
    const email = elements.authEmail.value.trim().toLowerCase();
    if (!email) {
        showToast("Please enter an email address to send OTP.", "error");
        return;
    }
    
    // Check Gmail constraint (except for admin)
    const isAdmin = email === "admin@example.com";
    if (!isAdmin && !isGmailAddress(email)) {
        showToast("Only Gmail addresses (@gmail.com) are allowed to login.", "error");
        return;
    }
    
    elements.authSendOtpBtn.disabled = true;
    elements.authSendOtpBtn.textContent = "Sending...";
    
    try {
        const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        
        if (res.ok) {
            showToast(`A verification code was sent to ${email}. Check your inbox.`, "info");
        } else {
            showToast(data.error || "Failed to send OTP", "error");
        }
    } catch (err) {
        showToast("Network error connecting to backend.", "error");
    }

    elements.authSendOtpBtn.disabled = false;
    elements.authSendOtpBtn.textContent = "Resend OTP";
}

async function handleAuthSubmit(e) {
    e.preventDefault();

    const name = elements.authName.value.trim();
    const email = elements.authEmail.value.trim().toLowerCase();
    const password = elements.authPassword.value;
    const otp = elements.authOtpInput.value.trim();

    // Check Gmail constraint (except for admin)
    const isAdmin = email === "admin@example.com";
    if (!isAdmin && !isGmailAddress(email)) {
        showToast("Only Gmail addresses (@gmail.com) are allowed to access this platform.", "error");
        return;
    }

    if (isLoginMode) {
        const method = state.authLoginMethod;
        try {
            const res = await fetch(`${API_BASE}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, method, otp })
            });
            const data = await res.json();
            
            if (res.ok) {
                startSession(data.user);
                await syncWithBackend();
                updateNavbar();
                closeAuthModal();
                showToast(`Welcome back, ${state.currentUser.name}!`);
                
                if (state.currentUser.role === "admin" || (state.currentUser.role === "teacher" && state.currentUser.isTeacherApproved)) {
                    switchView("admin-view");
                } else {
                    switchView("dashboard-view");
                }
            } else {
                showToast(data.error || "Invalid email or password.", "error");
            }
        } catch (err) {
            showToast("Network error connecting to backend.", "error");
        }
    } else {
        // Register User Mode
        const selectedRole = elements.authRole.value || "student";
        state.pendingRegistration = {
            name,
            email,
            password,
            role: selectedRole
        };

        try {
            const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            
            if (res.ok) {
                elements.registerOtpEmailDisplay.textContent = email;
                elements.registerOtpInput.value = "";
                elements.registerOtpModal.classList.add("active-modal");
                showToast(`Verification code sent to ${email}. Check your inbox.`, "info");
            } else {
                showToast(data.error || "Failed to send OTP", "error");
            }
        } catch (err) {
            showToast("Network error connecting to backend.", "error");
        }
    }
}

// Gmail OTP Registration Verification functions
function closeRegisterOtpModal() {
    elements.registerOtpModal.classList.remove("active-modal");
    elements.registerOtpForm.reset();
}

async function handleRegisterOtpSubmit(e) {
    e.preventDefault();
    const enteredOtp = elements.registerOtpInput.value.trim();

    if (!enteredOtp) {
        showToast("Please enter the verification code sent to your email.", "error");
        return;
    }

    if (!state.pendingRegistration) {
        showToast("No registration details found. Please try signing up again.", "error");
        closeRegisterOtpModal();
        return;
    }

    try {
        // The OTP is verified server-side here — the server never told the
        // browser what the correct code was, so this is a real check.
        const res = await fetch(`${API_BASE}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...state.pendingRegistration, otp: enteredOtp })
        });
        const data = await res.json();
        
        if (res.ok) {
            startSession(data.user);
            state.pendingRegistration = null;

            await syncWithBackend();
            updateNavbar();
            closeRegisterOtpModal();
            closeAuthModal();

            showToast(`Account successfully verified and created! Welcome, ${state.currentUser.name}!`, "success");
            switchView("dashboard-view");
        } else {
            showToast(data.error || "Registration failed.", "error");
        }
    } catch (err) {
        showToast("Network error connecting to backend.", "error");
    }
}

async function resendRegisterOtp() {
    if (!state.pendingRegistration) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: state.pendingRegistration.email })
        });
        const data = await res.json();
        if (res.ok) {
            elements.registerOtpInput.value = "";
            showToast(`New verification code sent to ${state.pendingRegistration.email}. Check your inbox.`, "info");
        } else {
            showToast(data.error || "Failed to resend OTP.", "error");
        }
    } catch (err) {
        showToast("Failed to resend OTP.", "error");
    }
}

// Google Sign-In Functions (Authentic UI Flow)
function openGoogleAuthModal() {
    closeAuthModal();
    elements.googleEmailForm.reset();
    elements.googlePasswordForm.reset();
    elements.googleEmailView.classList.remove("hidden");
    elements.googlePasswordView.classList.add("hidden");
    state.googlePendingEmail = null;
    elements.googleAuthModal.classList.add("active-modal");
}

function closeGoogleAuthModal() {
    elements.googleAuthModal.classList.remove("active-modal");
}

function handleLogout() {
    clearSession();
    updateNavbar();
    showToast("Successfully logged out.");
    switchView("home-view");
}

// ----------------------------------------------------
// 7. COURSE CATALOG & DETAIL RENDERING
// ----------------------------------------------------

function renderCourseCatalog() {
    const courses = getFromDB("edu_courses") || [];
    elements.courseListContainer.innerHTML = "";

    courses.forEach(course => {
        const hasAccess = hasCourseAccess(course.id);
        const card = document.createElement("div");
        card.className = "course-card glass-panel";
        
        card.innerHTML = `
            <img src="${course.image}" alt="${course.title}">
            <div class="course-card-content">
                <h3>${course.title}</h3>
                <p>${course.desc.substring(0, 120)}...</p>
                <div class="course-stats">
                    <span><i class="fa-solid fa-graduation-cap"></i> ${course.studentsCount} Students</span>
                    <span><i class="fa-solid fa-star" style="color: var(--warning);"></i> ${course.rating}</span>
                </div>
                <div class="course-card-footer">
                    <div class="course-price">
                        <del>₹${course.originalPrice || course.price * 2}</del>
                        ₹${course.price}
                    </div>
                    ${hasAccess 
                        ? `<button class="btn btn-accent learn-btn" data-id="${course.id}"><i class="fa-solid fa-play"></i> Study Now</button>`
                        : `<button class="btn btn-primary buy-btn" data-id="${course.id}"><i class="fa-solid fa-circle-plus"></i> Enroll</button>`
                    }
                </div>
            </div>
        `;

        // Direct detail page access when clicking title/description
        card.querySelector("img").addEventListener("click", () => openCourseDetails(course.id));
        card.querySelector("h3").addEventListener("click", () => openCourseDetails(course.id));

        const actionBtn = card.querySelector(".buy-btn, .learn-btn");
        actionBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const courseId = actionBtn.getAttribute("data-id");
            if (actionBtn.classList.contains("buy-btn")) {
                initiatePurchase(courseId);
            } else {
                openCourseLectures(courseId);
            }
        });

        elements.courseListContainer.appendChild(card);
    });
}

function openCourseDetails(courseId) {
    const courses = getFromDB("edu_courses") || [];
    const course = courses.find(c => c.id === courseId);
    if (!course) return;

    state.selectedCourse = course;
    const hasAccess = hasCourseAccess(course.id);

    const lectures = getFromDB("edu_lectures") || [];
    const courseLectures = lectures.filter(l => l.courseId === courseId);

    const resources = getFromDB("edu_resources") || [];
    const courseResources = resources.filter(r => r.courseId === courseId);

    elements.courseDetailContainer.innerHTML = `
        <div class="detail-main">
            <div class="detail-hero glass-panel">
                <h1>${course.title}</h1>
                <p>${course.desc}</p>
            </div>

            <div class="curriculum-section">
                <h2>Curriculum Lectures (${courseLectures.length} Chapters)</h2>
                <div class="curriculum-list">
                    ${courseLectures.map((lect, idx) => {
                        const canView = lect.gate === "free" || hasAccess;
                        return `
                            <div class="curriculum-item" data-lect-id="${lect.id}">
                                <div class="curriculum-item-info">
                                    <i class="fa-solid ${lect.gate === 'free' ? 'fa-circle-play' : 'fa-video'}"></i>
                                    <div>
                                        <div class="curriculum-item-title">${lect.title}</div>
                                        <div class="curriculum-item-meta">${lect.duration} mins &bull; ${lect.desc.substring(0, 70)}...</div>
                                    </div>
                                </div>
                                <div class="curriculum-item-action">
                                    ${canView 
                                        ? `<span class="unlocked-badge"><i class="fa-solid fa-lock-open"></i> Access Free</span>`
                                        : `<span class="locked-badge"><i class="fa-solid fa-lock"></i> Locked</span>`
                                    }
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            
            <div class="curriculum-section">
                <h2>Class Notes & DPPs (${courseResources.length} files)</h2>
                <div class="curriculum-list">
                    ${courseResources.map((res) => {
                        const canView = res.gate === "free" || hasAccess;
                        return `
                            <div class="curriculum-item">
                                <div class="curriculum-item-info">
                                    <i class="fa-solid ${res.type === 'note' ? 'fa-file-pdf' : 'fa-clipboard-question'}"></i>
                                    <div>
                                        <div class="curriculum-item-title">${res.title}</div>
                                        <div class="curriculum-item-meta">${res.type.toUpperCase()} &bull; ${res.size}</div>
                                    </div>
                                </div>
                                <div class="curriculum-item-action">
                                    ${canView 
                                        ? `<span class="unlocked-badge"><i class="fa-solid fa-lock-open"></i> Available</span>`
                                        : `<span class="locked-badge"><i class="fa-solid fa-lock"></i> Paid Content</span>`
                                    }
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>

        <div class="detail-sidebar">
            <div class="sticky-card glass-panel">
                <img src="${course.image}" alt="${course.title}">

                ${hasAccess 
                    ? `<button class="btn btn-accent learn-sidebar-btn" style="width: 100%;"><i class="fa-solid fa-circle-play"></i> Start Studying</button>`
                    : `<button class="btn btn-primary buy-sidebar-btn" style="width: 100%;"><i class="fa-solid fa-circle-plus"></i> Enroll in Course</button>`
                }

                <ul class="bullet-points">
                    <li><i class="fa-solid fa-circle-check"></i> Lifetime access to recordings</li>
                    <li><i class="fa-solid fa-circle-check"></i> Structured PDF Class Notes</li>
                    <li><i class="fa-solid fa-circle-check"></i> DPP Assignments & Solutions</li>
                    <li><i class="fa-solid fa-circle-check"></i> Certificate of Completion</li>
                </ul>
            </div>
        </div>
    `;

    // Hook events inside details page
    const detailBuyBtn = elements.courseDetailContainer.querySelector(".buy-sidebar-btn");
    const detailStudyBtn = elements.courseDetailContainer.querySelector(".learn-sidebar-btn");

    if (detailBuyBtn) {
        detailBuyBtn.addEventListener("click", () => initiatePurchase(courseId));
    }
    if (detailStudyBtn) {
        detailStudyBtn.addEventListener("click", () => openCourseLectures(courseId));
    }

    // Curriculum click listener (free files click should allow direct preview)
    elements.courseDetailContainer.querySelectorAll(".curriculum-item").forEach(item => {
        item.addEventListener("click", () => {
            const lectId = item.getAttribute("data-lect-id");
            if (!lectId) return;
            const lect = lectures.find(l => l.id === lectId);
            if (lect.gate === "free" || hasAccess) {
                openCourseLectures(courseId, lectId);
            } else {
                showToast("This content is locked. Purchase the course to unlock standard recordings and handouts.", "info");
                initiatePurchase(courseId);
            }
        });
    });

    switchView("course-details-view");
}

// ----------------------------------------------------
// 8. DIRECT COURSE ENROLLMENT (no payment gateway)
// ----------------------------------------------------

async function initiatePurchase(courseId) {
    if (!state.currentUser) {
        showToast("Please register or sign in to enroll in programs.", "info");
        openAuthModal();
        return;
    }

    const courses = getFromDB("edu_courses") || [];
    const course = courses.find(c => c.id === courseId);
    if (!course) return;

    try {
        const res = await fetch(`${API_BASE}/api/orders`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-user-id": state.currentUser.id
            },
            body: JSON.stringify({ courseId: course.id })
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || "Enrollment could not be processed.");
        }

        // Reflect the enrollment on the logged-in session and refresh cached data
        state.currentUser.enrolledCourses = data.enrolledCourses;
        await syncWithBackend();
        renderCourseCatalog();

        showToast(`You're enrolled in "${course.title}"! You can start studying now.`, "success");
    } catch (err) {
        showToast(err.message || "Enrollment failed. Please try again.", "error");
    }
}

// ----------------------------------------------------
// 9. STUDENT DASHBOARD RENDERING
// ----------------------------------------------------

function renderDashboard() {
    if (!state.currentUser) return;

    elements.dashboardWelcomeTitle.textContent = `Welcome back, ${state.currentUser.name}!`;

    const courses = getFromDB("edu_courses") || [];
    const enrolledIds = state.currentUser.enrolledCourses || [];
    const enrolledCourses = courses.filter(c => enrolledIds.includes(c.id));

    // Fill course cards
    elements.enrolledCoursesContainer.innerHTML = "";
    if (enrolledCourses.length === 0) {
        elements.enrolledCoursesContainer.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
                <i class="fa-solid fa-graduation-cap" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
                <p>You haven't enrolled in any Source Carrier courses yet.</p>
                <button class="btn btn-primary" id="dashboard-explore-btn" style="margin-top: 15px;">Browse Catalog</button>
            </div>
        `;
        document.getElementById("dashboard-explore-btn").addEventListener("click", () => {
            switchView("home-view");
        });
    } else {
        enrolledCourses.forEach(course => {
            const card = document.createElement("div");
            card.className = "course-card glass-panel";
            card.innerHTML = `
                <img src="${course.image}" alt="${course.title}">
                <div class="course-card-content">
                    <h3>${course.title}</h3>
                    <div style="background: rgba(255,255,255,0.05); height: 6px; border-radius: 3px; margin: 15px 0 8px 0; overflow:hidden;">
                        <div style="background: var(--primary-light); width: 33%; height:100%;"></div>
                    </div>
                    <div class="course-stats" style="margin-bottom: 15px;">
                        <span><i class="fa-solid fa-circle-play"></i> 1/4 Lectures Completed</span>
                        <span>33% Complete</span>
                    </div>
                    <button class="btn btn-primary start-study-btn" style="width: 100%;" data-id="${course.id}">
                        <i class="fa-solid fa-circle-play"></i> Access Course Content
                    </button>
                </div>
            `;
            card.querySelector(".start-study-btn").addEventListener("click", () => openCourseLectures(course.id));
            elements.enrolledCoursesContainer.appendChild(card);
        });
    }

    // Fill orders history
    const allOrders = getFromDB("edu_orders") || [];
    const studentOrders = allOrders.filter(o => o.userEmail === state.currentUser.email);
    elements.studentOrdersTableBody.innerHTML = "";

    if (studentOrders.length === 0) {
        elements.studentOrdersTableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-muted);">No records found.</td>
            </tr>
        `;
    } else {
        studentOrders.forEach(o => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td><code>${o.id}</code></td>
                <td>${o.courseTitle}</td>
                <td>₹${o.amountPaid}</td>
                <td>${o.paymentGateway}</td>
                <td><span class="badge badge-paid">${o.status}</span></td>
                <td>${o.date}</td>
            `;
            elements.studentOrdersTableBody.appendChild(row);
        });
    }

    // Fill Profile inputs
    elements.profileName.value = state.currentUser.name;
    elements.profileEmail.value = state.currentUser.email;
    elements.profilePhone.value = state.currentUser.phone || "";

    // Show/hide teacher pending approval banner
    if (state.currentUser.role === "teacher" && !state.currentUser.isTeacherApproved) {
        elements.teacherPendingBanner.style.display = "flex";
    } else {
        elements.teacherPendingBanner.style.display = "none";
    }

    // Render profile application section
    renderTeacherApplication();
}

function renderTeacherApplication() {
    if (!state.currentUser) return;
    
    const area = elements.teacherStatusArea;
    if (!area) return;

    area.innerHTML = "";

    if (state.currentUser.role === "student") {
        const text = document.createElement("span");
        text.innerHTML = `Current Role: <span class="badge badge-student">Student</span>`;
        text.style.fontWeight = "600";
        
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-primary";
        btn.style.padding = "8px 16px";
        btn.style.fontSize = "13px";
        btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Apply for Teacher Role`;
        btn.addEventListener("click", async () => {
            btn.disabled = true;
            try {
                const res = await fetch(`${API_BASE}/api/profile/apply-teacher`, {
                    method: "POST",
                    headers: { "x-user-id": state.currentUser.id }
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Application failed.");

                state.currentUser = data.user;
                updateNavbar();
                renderDashboard();
                showToast("Application submitted! Your teacher account is now pending admin approval.", "success");
            } catch (err) {
                showToast(err.message || "Could not submit application.", "error");
                btn.disabled = false;
            }
        });

        area.appendChild(text);
        area.appendChild(btn);
    } else if (state.currentUser.role === "teacher") {
        const text = document.createElement("span");
        text.style.fontWeight = "600";
        if (state.currentUser.isTeacherApproved) {
            text.innerHTML = `Status: <span class="badge badge-approved">Approved Instructor</span>`;
            area.appendChild(text);
        } else {
            text.innerHTML = `Status: <span class="badge badge-pending">Pending Admin Approval</span>`;
            
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn-secondary";
            btn.style.opacity = "0.6";
            btn.style.cursor = "not-allowed";
            btn.style.padding = "8px 16px";
            btn.style.fontSize = "13px";
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-hourglass"></i> Review in Progress`;
            
            area.appendChild(text);
            area.appendChild(btn);
        }
    } else if (state.currentUser.role === "admin") {
        const text = document.createElement("span");
        text.style.fontWeight = "600";
        text.innerHTML = `Status: <span class="badge badge-admin">Platform Administrator</span>`;
        area.appendChild(text);
    }
}

// Side tab triggers in student dashboard
document.querySelectorAll(".sidebar-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".sidebar-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".dashboard-pane").forEach(p => p.classList.remove("active-pane"));

        tab.classList.add("active");
        const paneId = tab.getAttribute("data-pane");
        document.getElementById(paneId).classList.add("active-pane");
    });
});

// Edit profile submit
elements.profileEditForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.currentUser) return;

    const submitBtn = elements.profileEditForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/profile`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "x-user-id": state.currentUser.id
            },
            body: JSON.stringify({
                name: elements.profileName.value.trim(),
                phone: elements.profilePhone.value.trim()
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Update failed.");

        state.currentUser = data.user;
        updateNavbar();
        showToast("Profile details updated successfully.");
    } catch (err) {
        showToast(err.message || "Could not update profile.", "error");
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
});

// ----------------------------------------------------
// 10. LECTURE VIEWER & SIMULATED PLAYBACK CONTROLLERS
// ----------------------------------------------------

function openCourseLectures(courseId, autoSelectLectId = null) {
    const courses = getFromDB("edu_courses") || [];
    const course = courses.find(c => c.id === courseId);
    if (!course) return;

    state.selectedCourse = course;

    const lectures = getFromDB("edu_lectures") || [];
    const courseLectures = lectures.filter(l => l.courseId === courseId);

    if (courseLectures.length === 0) {
        showToast("No lectures have been uploaded for this course yet.", "info");
        return;
    }

    // Determine target lecture to load
    let targetLect = courseLectures[0];
    if (autoSelectLectId) {
        targetLect = courseLectures.find(l => l.id === autoSelectLectId) || courseLectures[0];
    }

    switchView("lecture-viewer-view");
    renderLectureSidebar(courseLectures, targetLect.id);
    loadLectureVideo(targetLect);
}

function renderLectureSidebar(lecturesList, activeLectId) {
    elements.lectureSidebarList.innerHTML = "";

    lecturesList.forEach((lect) => {
        const hasAccess = hasCourseAccess(lect.courseId);
        const canView = lect.gate === "free" || hasAccess;

        const item = document.createElement("div");
        item.className = `lecture-list-item ${lect.id === activeLectId ? 'active' : ''}`;
        
        item.innerHTML = `
            <i class="fa-solid ${canView ? 'fa-circle-play' : 'fa-lock'}" style="color: ${canView ? 'var(--primary-light)' : 'var(--accent)'};"></i>
            <div>
                <div class="lecture-list-item-title">${lect.title}</div>
                <div class="lecture-list-item-duration">${lect.duration} mins &bull; ${lect.gate.toUpperCase()}</div>
            </div>
        `;

        item.addEventListener("click", () => {
            if (canView) {
                // Remove active classes
                document.querySelectorAll(".lecture-list-item").forEach(i => i.classList.remove("active"));
                item.classList.add("active");
                loadLectureVideo(lect);
            } else {
                showToast("Content gated. Complete course purchase to unlock this lecture.", "info");
                initiatePurchase(lect.courseId);
            }
        });

        elements.lectureSidebarList.appendChild(item);
    });
}

function loadLectureVideo(lecture) {
    state.selectedLecture = lecture;
    elements.activeLectureTitle.textContent = lecture.title;
    elements.activeLectureDesc.textContent = lecture.desc;

    // Actually load the real Cloudinary video file into the <video> element
    // instead of just faking a timer against lecture.duration.
    const videoEl = elements.lectureVideoEl;
    videoEl.pause();
    videoEl.src = lecture.url || "";
    videoEl.load();
    videoEl.muted = state.videoMuted;
    videoEl.playbackRate = state.videoSpeed;

    state.videoTime = 0;
    state.videoDuration = lecture.duration * 60; // fallback shown until real metadata loads

    elements.videoCurrentTime.textContent = formatTime(0);
    elements.videoDurationEl.textContent = formatTime(state.videoDuration);
    elements.videoSeekbarFill.style.width = "0%";

    // Reset player graphics
    elements.videoPlaceholderGraphic.classList.remove("is-hidden");
    elements.videoPlayPlaceholderBtn.className = "fa-solid fa-circle-play";
    elements.videoPlayerMessage.textContent = lecture.url ? "Click Play to start Lecture" : "No video file uploaded for this lecture yet.";
    elements.videoPlayBtn.innerHTML = '<i class="fa-solid fa-play"></i>';

    renderResources(lecture.courseId);
}

function toggleVideoPlayback() {
    const videoEl = elements.lectureVideoEl;
    if (!videoEl.src) {
        showToast("This lecture has no video file uploaded yet.", "error");
        return;
    }
    if (videoEl.paused || videoEl.ended) {
        videoEl.play().catch(() => showToast("Unable to play this video.", "error"));
    } else {
        videoEl.pause();
    }
}

// Real <video> element event wiring — drives the custom UI from actual playback state
elements.lectureVideoEl.addEventListener("loadedmetadata", () => {
    if (isFinite(elements.lectureVideoEl.duration) && elements.lectureVideoEl.duration > 0) {
        state.videoDuration = elements.lectureVideoEl.duration;
        elements.videoDurationEl.textContent = formatTime(state.videoDuration);
    }
});

elements.lectureVideoEl.addEventListener("play", () => {
    state.videoPlaying = true;
    elements.videoPlaceholderGraphic.classList.add("is-hidden");
    elements.videoPlayBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
});

elements.lectureVideoEl.addEventListener("pause", () => {
    state.videoPlaying = false;
    elements.videoPlayBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    if (!elements.lectureVideoEl.ended) {
        elements.videoPlaceholderGraphic.classList.remove("is-hidden");
        elements.videoPlayPlaceholderBtn.className = "fa-solid fa-circle-play";
        elements.videoPlayerMessage.textContent = "Lecture Paused";
    }
});

elements.lectureVideoEl.addEventListener("timeupdate", () => {
    state.videoTime = elements.lectureVideoEl.currentTime;
    elements.videoCurrentTime.textContent = formatTime(state.videoTime);
    if (state.videoDuration > 0) {
        const percent = (state.videoTime / state.videoDuration) * 100;
        elements.videoSeekbarFill.style.width = `${percent}%`;
    }
});

elements.lectureVideoEl.addEventListener("ended", () => {
    elements.videoPlaceholderGraphic.classList.remove("is-hidden");
    elements.videoPlayPlaceholderBtn.className = "fa-solid fa-circle-play";
    elements.videoPlayerMessage.textContent = "Lecture Finished — Click to Replay";
    showToast("Lecture video finished! Keep up the good work.");
});

elements.lectureVideoEl.addEventListener("error", () => {
    if (elements.lectureVideoEl.src) {
        elements.videoPlayerMessage.textContent = "This video could not be loaded.";
        elements.videoPlaceholderGraphic.classList.remove("is-hidden");
    }
});

// Seekbar scrubbing — now seeks the real video
elements.videoSeekbar.addEventListener("click", (e) => {
    const videoEl = elements.lectureVideoEl;
    if (!videoEl.src || !isFinite(videoEl.duration)) return;

    const rect = elements.videoSeekbar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));

    videoEl.currentTime = percent * videoEl.duration;
    elements.videoSeekbarFill.style.width = `${percent * 100}%`;
});

// Speed controller hook — sets real playbackRate
elements.videoSpeedSelect.addEventListener("change", (e) => {
    state.videoSpeed = parseFloat(e.target.value);
    elements.lectureVideoEl.playbackRate = state.videoSpeed;
});

// Mute toggle
elements.videoMuteBtn.addEventListener("click", () => {
    state.videoMuted = !state.videoMuted;
    elements.lectureVideoEl.muted = state.videoMuted;
    if (state.videoMuted) {
        elements.videoMuteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    } else {
        elements.videoMuteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    }
});

// Real fullscreen on the actual video element
elements.videoFullscreenBtn.addEventListener("click", () => {
    const player = elements.lectureVideoEl.closest(".custom-video-player") || elements.lectureVideoEl;
    if (player.requestFullscreen) {
        player.requestFullscreen();
    } else if (elements.lectureVideoEl.webkitEnterFullscreen) {
        elements.lectureVideoEl.webkitEnterFullscreen();
    } else {
        showToast("Fullscreen is not supported in this browser.", "error");
    }
});

// Bind main elements
elements.videoPlayPlaceholderBtn.addEventListener("click", toggleVideoPlayback);
elements.videoPlayBtn.addEventListener("click", toggleVideoPlayback);

// Tab controls for resources
document.querySelectorAll(".lecture-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".lecture-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");

        const tabId = tab.getAttribute("data-lecture-tab");
        state.activeLectureTab = tabId;

        if (tabId === "notes-tab") {
            elements.notesTabContainer.style.display = "flex";
            elements.dppsTabContainer.style.display = "none";
        } else {
            elements.notesTabContainer.style.display = "none";
            elements.dppsTabContainer.style.display = "flex";
        }
    });
});

function renderResources(courseId) {
    const resources = getFromDB("edu_resources") || [];
    const courseResources = resources.filter(r => r.courseId === courseId);
    const hasAccess = hasCourseAccess(courseId);

    elements.notesTabContainer.innerHTML = "";
    elements.dppsTabContainer.innerHTML = "";

    const notesList = courseResources.filter(r => r.type === "note");
    const dppsList = courseResources.filter(r => r.type === "dpp");

    // Helper to generate file items
    const generateResourceHTML = (res) => {
        const canDownload = res.gate === "free" || hasAccess;
        return `
            <div class="resource-card">
                <div class="resource-info">
                    <i class="fa-solid ${res.type === 'note' ? 'fa-file-pdf' : 'fa-clipboard-question'}"></i>
                    <div>
                        <div class="resource-name">${res.title}</div>
                        <div class="resource-size">${res.size} &bull; ${res.gate.toUpperCase()} Access</div>
                    </div>
                </div>
                ${canDownload 
                    ? `<div class="resource-actions" style="display:flex; gap:8px;">
                        <button class="btn btn-secondary r-view-btn" data-url="${res.url}"><i class="fa-solid fa-eye"></i> View</button>
                        <button class="btn btn-secondary r-dl-btn" data-title="${res.title}" data-url="${res.url}"><i class="fa-solid fa-download"></i> Download</button>
                       </div>`
                    : `<button class="btn btn-primary r-buy-btn" data-id="${res.courseId}"><i class="fa-solid fa-lock"></i> Buy Course</button>`
                }
            </div>
        `;
    };

    // Notes population
    if (notesList.length === 0) {
        elements.notesTabContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 14px;">No notes files available.</div>';
    } else {
        notesList.forEach(res => {
            const temp = document.createElement("div");
            temp.innerHTML = generateResourceHTML(res);
            elements.notesTabContainer.appendChild(temp.firstElementChild);
        });
    }

    // DPP assignments population
    if (dppsList.length === 0) {
        elements.dppsTabContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 14px;">No DPP practice problems available.</div>';
    } else {
        dppsList.forEach(res => {
            const temp = document.createElement("div");
            temp.innerHTML = generateResourceHTML(res);
            elements.dppsTabContainer.appendChild(temp.firstElementChild);
        });
    }

    // Bind event actions on downloaded buttons
    // Opens a URL reliably in a new tab via a real, temporary <a> element.
    // More reliable than window.open() here since some browsers/extensions
    // silently swallow window.open() calls even from a click handler.
    function openUrlInNewTab(url) {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Cloudinary serves files inline by default. To force an actual file
    // download (rather than opening in-browser) we insert the "fl_attachment"
    // delivery flag right after "/upload/" in the Cloudinary URL.
    function toCloudinaryDownloadUrl(url) {
        if (!url || !url.includes("/upload/")) return url;
        if (url.includes("/upload/fl_attachment")) return url;
        return url.replace("/upload/", "/upload/fl_attachment/");
    }

    document.querySelectorAll(".r-view-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const url = btn.getAttribute("data-url");
            if (!url) {
                showToast("No file is attached to this resource yet.", "error");
                return;
            }
            // Cloudinary serves "raw" files (like PDFs) with headers that make
            // the browser download them instead of rendering them, no matter
            // how we link to them directly. Routing through Mozilla's PDF.js
            // viewer renders the actual PDF (real text/vector quality, zoomable)
            // instead of Google's viewer, which flattens pages into blurry
            // low-resolution images.
            const viewerUrl = `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(url)}`;
            openUrlInNewTab(viewerUrl);
        });
    });

    document.querySelectorAll(".r-dl-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const title = btn.getAttribute("data-title");
            const url = btn.getAttribute("data-url");
            if (!url) {
                showToast("No file is attached to this resource yet.", "error");
                return;
            }
            openUrlInNewTab(toCloudinaryDownloadUrl(url));
            showToast(`Downloading: ${title}`, "success");
        });
    });

    document.querySelectorAll(".r-buy-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-id");
            initiatePurchase(targetId);
        });
    });
}

// ----------------------------------------------------
// 11. ADMINISTRATION MANAGEMENT PORTAL
// ----------------------------------------------------

function renderAdminPanel() {
    if (!state.currentUser) return;
    const isApprovedTeacher = state.currentUser.role === "teacher" && state.currentUser.isTeacherApproved;
    const isAdmin = state.currentUser.role === "admin";
    if (!isAdmin && !isApprovedTeacher) return;

    // Dynamically show/hide users and orders tabs
    const usersTab = document.getElementById("admin-users-tab");
    const ordersTab = document.getElementById("admin-orders-tab");
    
    if (state.currentUser.role === "teacher") {
        if (usersTab) usersTab.style.display = "none";
        if (ordersTab) ordersTab.style.display = "none";
        
        // If we were on users or orders pane, click the course tab
        const activeTab = document.querySelector(".admin-menu-item.active");
        if (activeTab && (activeTab.id === "admin-users-tab" || activeTab.id === "admin-orders-tab")) {
            const coursesTab = document.getElementById("admin-courses-tab");
            if (coursesTab) coursesTab.click();
        }
    } else {
        if (usersTab) usersTab.style.display = "flex";
        if (ordersTab) ordersTab.style.display = "flex";
    }

    // Update Console Title
    const consoleTitle = document.querySelector("#admin-view h1");
    if (consoleTitle) {
        if (state.currentUser.role === "admin") {
            consoleTitle.innerHTML = '<i class="fa-solid fa-user-shield"></i> Source Carrier Admin Console';
        } else {
            consoleTitle.innerHTML = '<i class="fa-solid fa-chalkboard-user"></i> Source Carrier Teacher Console';
        }
    }

    renderAdminCourses();
    renderAdminLectures();
    renderAdminResources();
    renderAdminUsers();
    renderAdminOrders();
    populateCourseSelectors();
}

// Side tab triggers in admin panel
document.querySelectorAll(".admin-menu-item").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".admin-menu-item").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".admin-section").forEach(s => s.classList.remove("active-admin-section"));

        tab.classList.add("active");
        const sectionId = tab.getAttribute("data-admin-pane");
        document.getElementById(sectionId).classList.add("active-admin-section");
    });
});

// Render functions for admin tables
function renderAdminCourses() {
    const courses = getFromDB("edu_courses") || [];
    const users = getFromDB("edu_users") || [];
    const lectures = getFromDB("edu_lectures") || [];
    
    elements.adminCoursesTableBody.innerHTML = "";

    courses.forEach(c => {
        const enrolledCount = users.filter(u => u.enrolledCourses.includes(c.id)).length;
        const lecturesCount = lectures.filter(l => l.courseId === c.id).length;

        const isAuthor = state.currentUser.role === "admin" || (c.creatorId === state.currentUser.id);
        const actionButtons = isAuthor 
            ? `
                <button class="btn btn-secondary view-course-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${c.id}"><i class="fa-solid fa-eye"></i> View</button>
                <button class="btn btn-secondary edit-course-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${c.id}"><i class="fa-solid fa-pen"></i> Edit</button>
                <button class="btn btn-danger delete-course-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${c.id}"><i class="fa-solid fa-trash"></i> Delete</button>
              `
            : `
                <button class="btn btn-secondary view-course-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${c.id}"><i class="fa-solid fa-eye"></i> View</button>
              `;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><img src="${c.image}" style="width: 50px; height: 35px; object-fit: cover; border-radius: 4px;"></td>
            <td style="font-weight: 600;">${c.title}</td>
            <td><span class="badge ${!c.creatorId || c.creatorId === 'user-admin' ? 'badge-admin' : 'badge-teacher'}">${c.creatorName || 'Admin Director'}</span></td>
            <td>₹${c.price}</td>
            <td>${lecturesCount} Lectures</td>
            <td>${enrolledCount} Students</td>
            <td>${actionButtons}</td>
        `;

        row.querySelector(".view-course-btn").addEventListener("click", () => {
            openCourseDetails(c.id);
        });
        if (isAuthor) {
            row.querySelector(".edit-course-btn").addEventListener("click", () => editCourse(c.id));
            row.querySelector(".delete-course-btn").addEventListener("click", () => deleteCourse(c.id));
        }

        elements.adminCoursesTableBody.appendChild(row);
    });
}

function renderAdminLectures() {
    const courses = getFromDB("edu_courses") || [];
    const lectures = getFromDB("edu_lectures") || [];
    elements.adminLecturesTableBody.innerHTML = "";

    lectures.forEach(l => {
        const course = courses.find(c => c.id === l.courseId);
        const courseTitle = course ? course.title : "Unknown Course";

        const isAuthor = state.currentUser.role === "admin" || (l.creatorId === state.currentUser.id);
        const actionButtons = isAuthor 
            ? `
                <button class="btn btn-secondary edit-lect-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${l.id}"><i class="fa-solid fa-pen"></i> Edit</button>
                <button class="btn btn-danger delete-lect-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${l.id}"><i class="fa-solid fa-trash"></i> Delete</button>
              `
            : `
                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px; opacity: 0.5; cursor: not-allowed;" disabled><i class="fa-solid fa-lock"></i> Locked</button>
              `;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td style="color: var(--text-muted);">${courseTitle}</td>
            <td style="font-weight: 600;">${l.title}</td>
            <td><span class="badge ${!l.creatorId || l.creatorId === 'user-admin' ? 'badge-admin' : 'badge-teacher'}">${l.creatorName || 'Admin Director'}</span></td>
            <td>${l.duration} mins</td>
            <td><code class="table-url-cell" title="${l.url}">${l.url ? l.url.split('/').pop() : ''}</code></td>
            <td><span class="badge ${l.gate === 'paid' ? 'badge-paid' : 'badge-student'}">${l.gate.toUpperCase()}</span></td>
            <td>${actionButtons}</td>
        `;

        if (isAuthor) {
            row.querySelector(".edit-lect-btn").addEventListener("click", () => editLecture(l.id));
            row.querySelector(".delete-lect-btn").addEventListener("click", () => deleteLecture(l.id));
        }

        elements.adminLecturesTableBody.appendChild(row);
    });
}

function renderAdminResources() {
    const courses = getFromDB("edu_courses") || [];
    const resources = getFromDB("edu_resources") || [];
    elements.adminResourcesTableBody.innerHTML = "";

    resources.forEach(r => {
        const course = courses.find(c => c.id === r.courseId);
        const courseTitle = course ? course.title : "Unknown Course";

        const isAuthor = state.currentUser.role === "admin" || (r.creatorId === state.currentUser.id);
        const actionButtons = isAuthor 
            ? `
                <button class="btn btn-secondary edit-res-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${r.id}"><i class="fa-solid fa-pen"></i> Edit</button>
                <button class="btn btn-danger delete-res-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${r.id}"><i class="fa-solid fa-trash"></i> Delete</button>
              `
            : `
                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px; opacity: 0.5; cursor: not-allowed;" disabled><i class="fa-solid fa-lock"></i> Locked</button>
              `;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td style="color: var(--text-muted);">${courseTitle}</td>
            <td style="font-weight: 600;">${r.title}</td>
            <td><span class="badge ${!r.creatorId || r.creatorId === 'user-admin' ? 'badge-admin' : 'badge-teacher'}">${r.creatorName || 'Admin Director'}</span></td>
            <td><code>${r.type.toUpperCase()}</code></td>
            <td>${r.size}</td>
            <td><span class="badge ${r.gate === 'paid' ? 'badge-paid' : 'badge-student'}">${r.gate.toUpperCase()}</span></td>
            <td>${actionButtons}</td>
        `;

        if (isAuthor) {
            row.querySelector(".edit-res-btn").addEventListener("click", () => editResource(r.id));
            row.querySelector(".delete-res-btn").addEventListener("click", () => deleteResource(r.id));
        }

        elements.adminResourcesTableBody.appendChild(row);
    });
}

function renderAdminUsers() {
    const users = getFromDB("edu_users") || [];
    elements.adminUsersTableBody.innerHTML = "";

    users.forEach(u => {
        let roleBadge = "badge-student";
        if (u.role === "admin") roleBadge = "badge-admin";
        else if (u.role === "teacher") roleBadge = "badge-teacher";

        let approvalHtml = "N/A";
        let approveRevokeBtn = "";
        
        if (u.role === "teacher") {
            if (u.isTeacherApproved) {
                approvalHtml = `<span class="badge badge-approved"><i class="fa-solid fa-circle-check"></i> Approved</span>`;
                approveRevokeBtn = `<button class="btn btn-secondary revoke-user-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${u.id}"><i class="fa-solid fa-xmark"></i> Revoke</button>`;
            } else {
                approvalHtml = `<span class="badge badge-pending"><i class="fa-solid fa-circle-minus"></i> Pending</span>`;
                approveRevokeBtn = `<button class="btn btn-primary approve-user-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${u.id}"><i class="fa-solid fa-check"></i> Approve</button>`;
            }
        }

        let enrolledText = "";
        if (u.role === "admin") {
            enrolledText = "All (Admin Access)";
        } else if (u.role === "teacher") {
            enrolledText = "Instructor Account";
        } else {
            enrolledText = `${u.enrolledCourses ? u.enrolledCourses.length : 0} courses`;
        }

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><code>${u.id}</code></td>
            <td>
                <div style="font-weight: 600;">${u.name}</div>
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                    <i class="fa-solid fa-envelope" style="font-size: 10px;"></i> ${u.email}
                    ${u.phone ? ` | <i class="fa-solid fa-phone" style="font-size: 10px;"></i> ${u.phone}` : ''}
                </div>
            </td>
            <td><span class="badge ${roleBadge}">${u.role.toUpperCase()}</span></td>
            <td>${approvalHtml}</td>
            <td>${enrolledText}</td>
            <td>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary edit-user-btn" style="padding: 6px 12px; font-size: 12px;" data-id="${u.id}"><i class="fa-solid fa-pen"></i> Edit</button>
                    ${approveRevokeBtn}
                </div>
            </td>
        `;

        row.querySelector(".edit-user-btn").addEventListener("click", () => openEditUserModal(u.id));
        if (u.role === "teacher") {
            if (u.isTeacherApproved) {
                row.querySelector(".revoke-user-btn").addEventListener("click", () => toggleTeacherApproval(u.id, false));
            } else {
                row.querySelector(".approve-user-btn").addEventListener("click", () => toggleTeacherApproval(u.id, true));
            }
        }

        elements.adminUsersTableBody.appendChild(row);
    });
}

function renderAdminOrders() {
    const orders = getFromDB("edu_orders") || [];
    elements.adminOrdersTableBody.innerHTML = "";

    orders.forEach(o => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><code>${o.id}</code></td>
            <td>${o.userEmail}</td>
            <td>${o.courseTitle}</td>
            <td>${o.paymentGateway}</td>
            <td>${o.date}</td>
            <td style="font-weight: 700; color: var(--success);">₹${o.amountPaid}</td>
        `;
        elements.adminOrdersTableBody.appendChild(row);
    });
}

function populateCourseSelectors() {
    const courses = getFromDB("edu_courses") || [];
    
    // Clear list
    elements.lectureCourseSelect.innerHTML = "";
    elements.resourceCourseSelect.innerHTML = "";

    const filteredCourses = state.currentUser.role === "admin" 
        ? courses 
        : courses.filter(c => c.creatorId === state.currentUser.id);

    filteredCourses.forEach(c => {
        const opt1 = document.createElement("option");
        opt1.value = c.id;
        opt1.textContent = c.title;
        elements.lectureCourseSelect.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = c.id;
        opt2.textContent = c.title;
        elements.resourceCourseSelect.appendChild(opt2);
    });
}

// ----------------------------------------------------
// 12. ADMIN EDIT & MUTATION CONTROLLERS
// ----------------------------------------------------

// Course mutations
elements.adminCreateCourseBtn.addEventListener("click", () => {
    elements.adminCourseForm.reset();
    elements.courseFormId.value = "";
    if (elements.courseImageCurrent) elements.courseImageCurrent.textContent = "";
    elements.courseFormTitle.textContent = "Create New Course";
    elements.courseFormModal.classList.add("active-modal");
});

elements.courseModalClose.addEventListener("click", () => {
    elements.courseFormModal.classList.remove("active-modal");
});

function editCourse(id) {
    const courses = getFromDB("edu_courses") || [];
    const course = courses.find(c => c.id === id);
    if (!course) return;

    elements.courseFormId.value = course.id;
    elements.courseTitle.value = course.title;
    elements.courseDesc.value = course.desc;
    elements.coursePriceInput.value = course.price;
    elements.courseImageFile.value = "";
    if (elements.courseImageCurrent) {
        elements.courseImageCurrent.textContent = course.image ? `(Current: ${course.image.split('/').pop()} — leave blank to keep it)` : "";
    }

    elements.courseFormTitle.textContent = "Update Course Details";
    elements.courseFormModal.classList.add("active-modal");
}

async function deleteCourse(id) {
    if (confirm("Are you sure you want to delete this course? This will remove catalog visibility.")) {
        await fetch(`${API_BASE}/api/courses/${id}`, { method: "DELETE", headers: { "x-user-id": state.currentUser.id } });
        await syncWithBackend();
        showToast("Course deleted from database.", "success");
        renderAdminPanel();
        renderCourseCatalog();
    }
}

elements.adminCourseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = elements.courseFormId.value;
    const submitBtn = elements.adminCourseForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const formData = new FormData();
    formData.append("title", elements.courseTitle.value.trim());
    formData.append("desc", elements.courseDesc.value.trim());
    formData.append("price", elements.coursePriceInput.value);

    if (elements.courseImageFile.files.length > 0) {
        formData.append("thumbnail", elements.courseImageFile.files[0]);
    }

    const showProgress = elements.courseImageFile.files.length > 0;
    if (showProgress) {
        elements.courseUploadProgressWrap.style.display = "flex";
        elements.courseUploadProgressFill.style.width = "0%";
        elements.courseUploadProgressLabel.textContent = "0%";
    }
    const onProgress = (pct) => {
        elements.courseUploadProgressFill.style.width = `${pct}%`;
        elements.courseUploadProgressLabel.textContent = `${pct}%`;
    };

    try {
        if (id) {
            const res = await uploadWithProgress(
                `${API_BASE}/api/courses/${id}`, "PUT", formData,
                { "x-user-id": state.currentUser.id }, onProgress
            );
            if (!res.ok) throw new Error((await res.json()).error || "Update failed.");
            showToast("Course information updated.");
        } else {
            const res = await uploadWithProgress(
                `${API_BASE}/api/courses`, "POST", formData,
                { "x-user-id": state.currentUser.id }, onProgress
            );
            if (!res.ok) throw new Error((await res.json()).error || "Creation failed.");
            showToast("New Course registered in catalog.");
        }
        await syncWithBackend();
        elements.courseFormModal.classList.remove("active-modal");
        renderAdminPanel();
        renderCourseCatalog();
    } catch (err) {
        showToast(err.message || "Failed to save course.", "error");
    } finally {
        elements.courseUploadProgressWrap.style.display = "none";
    }
    submitBtn.disabled = false;
});

// Lecture mutations
elements.adminCreateLectureBtn.addEventListener("click", () => {
    elements.adminLectureForm.reset();
    elements.lectureFormId.value = "";
    if (elements.lectureVideoCurrent) elements.lectureVideoCurrent.textContent = "";
    elements.lectureFormTitle.textContent = "Upload Video Lecture";
    elements.lectureFormModal.classList.add("active-modal");
});

elements.lectureModalClose.addEventListener("click", () => {
    elements.lectureFormModal.classList.remove("active-modal");
});

function editLecture(id) {
    const lectures = getFromDB("edu_lectures") || [];
    const lect = lectures.find(l => l.id === id);
    if (!lect) return;

    elements.lectureFormId.value = lect.id;
    elements.lectureCourseSelect.value = lect.courseId;
    elements.lectureTitleInput.value = lect.title;
    elements.lectureDescInput.value = lect.desc;
    elements.lectureVideoFile.value = "";
    if (elements.lectureVideoCurrent) {
        elements.lectureVideoCurrent.textContent = lect.url ? `(Current: ${lect.url.split('/').pop()} — leave blank to keep it)` : "";
    }
    elements.lectureDurationInput.value = lect.duration;
    elements.lectureGateSelect.value = lect.gate;

    elements.lectureFormTitle.textContent = "Update Lecture Video details";
    elements.lectureFormModal.classList.add("active-modal");
}

async function deleteLecture(id) {
    if (confirm("Remove this lecture video from course outline?")) {
        await fetch(`${API_BASE}/api/lectures/${id}`, { method: "DELETE", headers: { "x-user-id": state.currentUser.id } });
        await syncWithBackend();
        showToast("Lecture removed successfully.", "success");
        renderAdminPanel();
    }
}

// Auto-detect lecture duration from the chosen video file itself, instead of
// making the teacher type it in by hand. We load the file into a throwaway
// <video> element just to read its metadata (duration), then discard it.
elements.lectureVideoFile.addEventListener("change", () => {
    const file = elements.lectureVideoFile.files[0];
    if (!file) return;

    elements.lectureDurationInput.value = "";
    elements.lectureDurationInput.placeholder = "Detecting duration...";

    const probeEl = document.createElement("video");
    probeEl.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);

    probeEl.addEventListener("loadedmetadata", () => {
        URL.revokeObjectURL(objectUrl);
        if (isFinite(probeEl.duration) && probeEl.duration > 0) {
            const minutes = Math.max(1, Math.round(probeEl.duration / 60));
            elements.lectureDurationInput.value = minutes;
            elements.lectureDurationInput.placeholder = "e.g. 45";
        } else {
            elements.lectureDurationInput.placeholder = "Could not auto-detect — enter manually";
        }
    });

    probeEl.addEventListener("error", () => {
        URL.revokeObjectURL(objectUrl);
        elements.lectureDurationInput.placeholder = "Could not auto-detect — enter manually";
    });

    probeEl.src = objectUrl;
});

elements.adminLectureForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = elements.lectureFormId.value;
    const submitBtn = elements.adminLectureForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const formData = new FormData();
    formData.append("courseId", elements.lectureCourseSelect.value);
    formData.append("title", elements.lectureTitleInput.value.trim());
    formData.append("desc", elements.lectureDescInput.value.trim());
    formData.append("duration", elements.lectureDurationInput.value);
    formData.append("gate", elements.lectureGateSelect.value);

    if (elements.lectureVideoFile.files.length > 0) {
        formData.append("video", elements.lectureVideoFile.files[0]);
    }

    const showProgress = elements.lectureVideoFile.files.length > 0;
    if (showProgress) {
        elements.lectureUploadProgressWrap.style.display = "flex";
        elements.lectureUploadProgressFill.style.width = "0%";
        elements.lectureUploadProgressLabel.textContent = "0%";
    }
    const onProgress = (pct) => {
        elements.lectureUploadProgressFill.style.width = `${pct}%`;
        elements.lectureUploadProgressLabel.textContent = `${pct}%`;
    };

    try {
        if (id) {
            const res = await uploadWithProgress(
                `${API_BASE}/api/lectures/${id}`, "PUT", formData,
                { "x-user-id": state.currentUser.id }, onProgress
            );
            if (!res.ok) throw new Error((await res.json()).error || "Update failed.");
            showToast("Lecture outline modified.");
        } else {
            const res = await uploadWithProgress(
                `${API_BASE}/api/lectures`, "POST", formData,
                { "x-user-id": state.currentUser.id }, onProgress
            );
            if (!res.ok) throw new Error((await res.json()).error || "Upload failed.");
            showToast("Lecture uploaded and gated successfully.");
        }
        await syncWithBackend();
        elements.lectureFormModal.classList.remove("active-modal");
        renderAdminPanel();
    } catch (err) {
        showToast(err.message || "Failed to save lecture.", "error");
    } finally {
        elements.lectureUploadProgressWrap.style.display = "none";
    }
    submitBtn.disabled = false;
});

// Resource documents mutations
elements.adminCreateResourceBtn.addEventListener("click", () => {
    elements.adminResourceForm.reset();
    elements.resourceFormId.value = "";
    if (elements.resourceFileCurrent) elements.resourceFileCurrent.textContent = "";
    elements.resourceFormTitle.textContent = "Upload Resource Document";
    elements.resourceFormModal.classList.add("active-modal");
});

elements.resourceModalClose.addEventListener("click", () => {
    elements.resourceFormModal.classList.remove("active-modal");
});

function editResource(id) {
    const resources = getFromDB("edu_resources") || [];
    const res = resources.find(r => r.id === id);
    if (!res) return;

    elements.resourceFormId.value = res.id;
    elements.resourceCourseSelect.value = res.courseId;
    elements.resourceTitleInput.value = res.title;
    elements.resourceTypeSelect.value = res.type;
    elements.resourceFile.value = "";
    if (elements.resourceFileCurrent) {
        elements.resourceFileCurrent.textContent = res.url ? `(Current: ${res.url.split('/').pop()}, ${res.size} — leave blank to keep it)` : "";
    }
    elements.resourceGateSelect.value = res.gate;

    elements.resourceFormTitle.textContent = "Update Document Details";
    elements.resourceFormModal.classList.add("active-modal");
}

async function deleteResource(id) {
    if (confirm("Delete document from student course area?")) {
        await fetch(`${API_BASE}/api/resources/${id}`, { method: "DELETE", headers: { "x-user-id": state.currentUser.id } });
        await syncWithBackend();
        showToast("PDF document removed.", "success");
        renderAdminPanel();
    }
}

elements.adminResourceForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = elements.resourceFormId.value;
    const submitBtn = elements.adminResourceForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const formData = new FormData();
    formData.append("courseId", elements.resourceCourseSelect.value);
    formData.append("title", elements.resourceTitleInput.value.trim());
    formData.append("type", elements.resourceTypeSelect.value);
    formData.append("gate", elements.resourceGateSelect.value);

    if (elements.resourceFile.files.length > 0) {
        formData.append("document", elements.resourceFile.files[0]);
    }

    const showProgress = elements.resourceFile.files.length > 0;
    if (showProgress) {
        elements.resourceUploadProgressWrap.style.display = "flex";
        elements.resourceUploadProgressFill.style.width = "0%";
        elements.resourceUploadProgressLabel.textContent = "0%";
    }
    const onProgress = (pct) => {
        elements.resourceUploadProgressFill.style.width = `${pct}%`;
        elements.resourceUploadProgressLabel.textContent = `${pct}%`;
    };

    try {
        if (id) {
            const res = await uploadWithProgress(
                `${API_BASE}/api/resources/${id}`, "PUT", formData,
                { "x-user-id": state.currentUser.id }, onProgress
            );
            if (!res.ok) throw new Error((await res.json()).error || "Update failed.");
            showToast("Resource details updated.");
        } else {
            const res = await uploadWithProgress(
                `${API_BASE}/api/resources`, "POST", formData,
                { "x-user-id": state.currentUser.id }, onProgress
            );
            if (!res.ok) throw new Error((await res.json()).error || "Upload failed.");
            showToast("Document posted for target course.");
        }
        await syncWithBackend();
        elements.resourceFormModal.classList.remove("active-modal");
        renderAdminPanel();
    } catch (err) {
        showToast(err.message || "Failed to save resource.", "error");
    } finally {
        elements.resourceUploadProgressWrap.style.display = "none";
    }
    submitBtn.disabled = false;
});

// User Directory mutations
async function toggleTeacherApproval(userId, isApproved) {
    try {
        const res = await fetch(`${API_BASE}/api/users/${userId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "x-user-id": state.currentUser.id
            },
            body: JSON.stringify({ isTeacherApproved: isApproved })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Update failed.");

        showToast(isApproved ? `Teacher status approved for ${data.user.name}.` : `Teacher status revoked for ${data.user.name}.`, "success");
        await syncWithBackend();
        renderAdminPanel();

        // If the current user's approval status was modified, update their session state!
        if (state.currentUser && state.currentUser.id === userId) {
            state.currentUser.isTeacherApproved = isApproved;
            updateNavbar();
        }
    } catch (err) {
        showToast(err.message || "Could not update teacher status.", "error");
    }
}

function openEditUserModal(userId) {
    const users = getFromDB("edu_users") || [];
    const user = users.find(u => u.id === userId);
    if (!user) return;

    elements.userFormId.value = user.id;
    elements.userNameInput.value = user.name;
    elements.userEmailInput.value = user.email;
    elements.userPhoneInput.value = user.phone || "";
    elements.userPasswordInput.value = user.password;
    elements.userRoleSelect.value = user.role;
    elements.userApprovalSelect.value = user.isTeacherApproved ? "approved" : "pending";

    // Show/hide approval group based on role
    toggleApprovalSelectVisibility(user.role);

    elements.userFormModal.classList.add("active-modal");
}

function toggleApprovalSelectVisibility(role) {
    const approvalGroup = document.getElementById("user-approval-group");
    if (approvalGroup) {
        if (role === "teacher") {
            approvalGroup.style.display = "block";
        } else {
            approvalGroup.style.display = "none";
        }
    }
}

// Bind role select change in Edit User Modal to toggle approval field visibility
elements.userRoleSelect.addEventListener("change", (e) => {
    toggleApprovalSelectVisibility(e.target.value);
});

elements.userModalClose.addEventListener("click", () => {
    elements.userFormModal.classList.remove("active-modal");
});

elements.adminUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = elements.userFormId.value;
    const users = getFromDB("edu_users") || [];
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return;

    const email = elements.userEmailInput.value.trim().toLowerCase();

    // Validate Gmail constraint (except for admin)
    const role = elements.userRoleSelect.value;
    const isAdmin = email === "admin@example.com" || role === "admin";
    if (!isAdmin && !isGmailAddress(email)) {
        showToast("Only Gmail addresses (@gmail.com) are allowed.", "error");
        return;
    }

    // Check if email already exists for another user
    const emailExists = users.some(u => u.email === email && u.id !== id);
    if (emailExists) {
        showToast("Email address is already in use by another account.", "error");
        return;
    }

    const isTeacherApproved = (role === "teacher")
        ? (elements.userApprovalSelect.value === "approved")
        : (role === "admin");

    const submitBtn = elements.adminUserForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/users/${id}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "x-user-id": state.currentUser.id
            },
            body: JSON.stringify({
                name: elements.userNameInput.value.trim(),
                email,
                phone: elements.userPhoneInput.value.trim(),
                password: elements.userPasswordInput.value,
                role,
                isTeacherApproved
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Update failed.");

        // Update current user session if editing self
        if (state.currentUser && state.currentUser.id === id) {
            state.currentUser = data.user;
            updateNavbar();
        }

        await syncWithBackend();
        elements.userFormModal.classList.remove("active-modal");
        showToast("User details successfully updated.");
        renderAdminPanel();
    } catch (err) {
        showToast(err.message || "Could not update user.", "error");
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
});

elements.adminDeleteUserBtn.addEventListener("click", async () => {
    const id = elements.userFormId.value;
    if (!id) return;

    if (id === "user-admin" || (state.currentUser && state.currentUser.id === id)) {
        showToast("You cannot delete the primary admin account or your currently logged in account.", "error");
        return;
    }

    if (confirm("Are you sure you want to permanently delete this user account? This action cannot be undone.")) {
        try {
            const res = await fetch(`${API_BASE}/api/users/${id}`, {
                method: "DELETE",
                headers: { "x-user-id": state.currentUser.id }
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Delete failed.");
            }

            await syncWithBackend();
            elements.userFormModal.classList.remove("active-modal");
            showToast("Account deleted from database.");
            renderAdminPanel();
        } catch (err) {
            showToast(err.message || "Could not delete account.", "error");
        }
    }
});

// ----------------------------------------------------
// 12.5 CHAT ROOM CONTROLLER
// ----------------------------------------------------

const channels = [
    { id: 'physics-doubts', name: 'Physics Doubts', icon: 'fa-atom' },
    { id: 'chemistry-doubts', name: 'Chemistry Doubts', icon: 'fa-flask' },
    { id: 'maths-doubts', name: 'Maths Doubts', icon: 'fa-square-root-variable' },
    { id: 'announcements', name: 'Announcements', icon: 'fa-bullhorn' }
];

function renderChatChannels() {
    elements.chatChannelsList.innerHTML = "";
    channels.forEach(ch => {
        const li = document.createElement("li");
        li.className = `channel-item ${state.activeChatChannel === ch.id ? 'active' : ''}`;
        li.innerHTML = `<i class="fa-solid ${ch.icon}"></i> ${ch.name}`;
        li.addEventListener("click", () => {
            state.activeChatChannel = ch.id;
            renderChatChannels();
            loadActiveChat();
        });
        elements.chatChannelsList.appendChild(li);
    });
}

async function loadActiveChat() {
    if (!state.currentUser) return;
    const activeCh = channels.find(c => c.id === state.activeChatChannel);
    if (activeCh) elements.chatActiveChannelName.textContent = activeCh.name;

    try {
        const res = await fetch(`${API_BASE}/api/chat/${state.activeChatChannel}`, {
            headers: { 'x-user-id': state.currentUser.id }
        });
        if (res.ok) {
            const messages = await res.json();
            renderChatMessages(messages);
        }
        
        let usersList = getFromDB("edu_users") || [];
        if (state.currentUser.role !== 'admin') {
            // Non-admins can't call /api/users (admin-only); use the sanitized directory instead
            const resUsers = await fetch(`${API_BASE}/api/users/directory`, {
                headers: { 'x-user-id': state.currentUser.id }
            });
            if (resUsers.ok) {
                usersList = await resUsers.json();
            }
        }
        renderChatMembers(usersList);
        
    } catch (err) {
        console.error("Error loading chat:", err);
    }
}

function renderChatMessages(messages) {
    elements.chatMessagesContainer.innerHTML = "";
    if (messages.length === 0) {
        elements.chatMessagesContainer.innerHTML = `<div style="text-align:center; color:#888; padding:2rem;">No messages here yet. Be the first!</div>`;
        return;
    }

    messages.forEach(msg => {
        const div = document.createElement("div");
        const isSelf = msg.userId === state.currentUser.id;
        const roleClass = msg.role === "teacher" || msg.role === "admin" ? "teacher" : "student";
        
        div.className = `message ${isSelf ? 'self' : roleClass}`;
        
        let headerHtml = "";
        if (!isSelf) {
            const badge = msg.role === "teacher" ? '<span class="role-badge">Teacher</span>' : '';
            headerHtml = `<div class="msg-header">${msg.userName} ${badge}</div>`;
        }
        
        div.innerHTML = `
            ${headerHtml}
            <div class="msg-content">${msg.message}</div>
            <div class="msg-time">${msg.timestamp.substring(11, 16)}</div>
        `;
        elements.chatMessagesContainer.appendChild(div);
    });
    
    elements.chatMessagesContainer.scrollTop = elements.chatMessagesContainer.scrollHeight;
}

function renderChatMembers(users) {
    elements.chatInstructorsList.innerHTML = "";
    elements.chatStudentsList.innerHTML = "";
    
    const teachers = users.filter(u => u.role === "teacher" || u.role === "admin");
    const students = users.filter(u => u.role === "student");
    
    // Active simulation: Some users are online, some are offline
    let onlineCount = 0;
    
    teachers.forEach(t => {
        const isOnline = t.id === "user-admin" || Math.random() > 0.1; // High chance teachers are online
        if (isOnline) onlineCount++;
        elements.chatInstructorsList.innerHTML += `
            <li class="member-item">
                <div class="member-avatar">${t.name.charAt(0)}</div>
                <div class="member-info">
                    <div class="member-name">${t.name}</div>
                    <div class="member-status ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</div>
                </div>
            </li>
        `;
    });
    
    students.slice(0, 10).forEach(s => {
        const isOnline = Math.random() > 0.6 || s.id === state.currentUser.id; // Lower chance for random students
        if (isOnline) onlineCount++;
        elements.chatStudentsList.innerHTML += `
            <li class="member-item">
                <div class="member-avatar">${s.name.charAt(0)}</div>
                <div class="member-info">
                    <div class="member-name">${s.name}</div>
                    <div class="member-status ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</div>
                </div>
            </li>
        `;
    });
    
    elements.chatOnlineCount.textContent = `${onlineCount} Online`;
}

function startChatPolling() {
    if (state.chatPollInterval) clearInterval(state.chatPollInterval);
    state.chatPollInterval = setInterval(() => {
        if (state.activeView === "chat-view") {
            loadActiveChat();
        }
    }, 2500);
}

// ----------------------------------------------------
// 13. BOOTSTRAPPING & EVENT REGISTRATIONS
// ----------------------------------------------------

function setupEventListeners() {
    // Nav Click handlers
    elements.logoBtn.addEventListener("click", () => switchView("home-view"));

    // Day / Night mode toggle — persisted in localStorage so the choice sticks
    // across visits (this is a real site, not a sandboxed artifact, so
    // localStorage works fine here).
    elements.themeToggleBtn.addEventListener("click", () => {
        const isLight = document.documentElement.getAttribute("data-theme") === "light";
        if (isLight) {
            document.documentElement.removeAttribute("data-theme");
            localStorage.setItem("scv_theme", "dark");
        } else {
            document.documentElement.setAttribute("data-theme", "light");
            localStorage.setItem("scv_theme", "light");
        }
    });
    elements.navCourses.addEventListener("click", (e) => {
        e.preventDefault();
        switchView("home-view");
    });
    elements.navDashboard.addEventListener("click", (e) => {
        e.preventDefault();
        switchView("dashboard-view");
    });
    elements.navAdmin.addEventListener("click", (e) => {
        e.preventDefault();
        switchView("admin-view");
    });

    // Auth Actions
    elements.loginNavBtn.addEventListener("click", openAuthModal);
    elements.logoutBtn.addEventListener("click", handleLogout);
    elements.authModalClose.addEventListener("click", closeAuthModal);
    elements.authForm.addEventListener("submit", handleAuthSubmit);
    
    // Auth Tabs
    elements.authPassTab.addEventListener("click", () => setAuthLoginMethod("password"));
    elements.authOtpTab.addEventListener("click", () => setAuthLoginMethod("otp"));
    elements.authSendOtpBtn.addEventListener("click", simulateSendAuthOTP);

    // Google Sign-In Actions
    elements.googleLoginBtn.addEventListener("click", openGoogleAuthModal);
    elements.googleAuthClose.addEventListener("click", closeGoogleAuthModal);
    
    elements.googleEmailForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = elements.googleInputEmail.value.trim().toLowerCase();
        
        elements.googleLoadingBar.classList.remove("hidden");
        setTimeout(() => {
            elements.googleLoadingBar.classList.add("hidden");
            state.googlePendingEmail = email;
            elements.googleDisplayEmail.textContent = email;
            elements.googleEmailView.classList.add("hidden");
            elements.googlePasswordView.classList.remove("hidden");
        }, 1200);
    });

    elements.googlePasswordForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const password = elements.googleInputPassword.value;
        const email = state.googlePendingEmail;
        
        try {
            const res = await fetch(`${API_BASE}/api/auth/google-login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });
            
            const data = await res.json();
            if (res.ok) {
                startSession(data.user);
                await syncWithBackend();
                updateNavbar();
                closeGoogleAuthModal();
                showToast(`Signed in successfully with Google account: ${email}`, "success");
                
                if (state.currentUser.role === "admin" || state.currentUser.role === "teacher") {
                    switchView("admin-view");
                } else {
                    switchView("dashboard-view");
                }
            } else {
                showToast(data.error || "Authentication failed.", "error");
            }
        } catch (err) {
            showToast("Network error connecting to backend.", "error");
        }
    });

    elements.googleShowPassword.addEventListener("change", (e) => {
        if (e.target.checked) {
            elements.googleInputPassword.type = "text";
        } else {
            elements.googleInputPassword.type = "password";
        }
    });
    
    // Chat Actions
    elements.navChat.addEventListener("click", (e) => {
        e.preventDefault();
        switchView("chat-view");
        elements.navChat.classList.add("active");
        renderChatChannels();
        loadActiveChat();
        startChatPolling();
    });

    elements.chatMessageForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const content = elements.chatMessageInput.value.trim();
        if (!content) return;

        elements.chatMessageInput.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/chat`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "x-user-id": state.currentUser.id
                },
                body: JSON.stringify({ channel: state.activeChatChannel, message: content })
            });
            if (res.ok) {
                elements.chatMessageInput.value = "";
                await loadActiveChat();
            }
        } catch (err) {
            showToast("Failed to send message.", "error");
        }
        elements.chatMessageInput.disabled = false;
        elements.chatMessageInput.focus();
    });

    elements.googleAuthModal.addEventListener("click", (e) => {
        if (e.target === elements.googleAuthModal) {
            closeGoogleAuthModal();
        }
    });

    // Gmail OTP Registration Actions
    elements.registerOtpClose.addEventListener("click", closeRegisterOtpModal);
    elements.registerOtpForm.addEventListener("submit", handleRegisterOtpSubmit);
    elements.registerOtpResendBtn.addEventListener("click", resendRegisterOtp);

    elements.registerOtpModal.addEventListener("click", (e) => {
        if (e.target === elements.registerOtpModal) {
            closeRegisterOtpModal();
        }
    });

    // Global dashboard back buttons
    elements.backToCoursesBtn.addEventListener("click", () => switchView("home-view"));
    elements.backToDashboardBtn.addEventListener("click", () => switchView("dashboard-view"));

    // Razorpay Checkout Actions
    // Razorpay simulation removed — enrollment now happens directly via initiatePurchase()

    // Explore anchor scroll
    elements.exploreBtn.addEventListener("click", () => {
        elements.exploreTarget.scrollIntoView({ behavior: 'smooth' });
    });
}

// Initial script bootstrap
async function bootstrap() {
    setupEventListeners();
    await restoreSession();
    await syncWithBackend();
    updateNavbar();
    renderCourseCatalog();
}

bootstrap();