const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// One storage engine, folder/resource_type chosen per upload based on the
// form field name — mirrors the old local-disk logic (thumbnail/video/document).
const storage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => {
        if (file.fieldname === 'thumbnail') {
            return {
                folder: 'edupay/thumbnails',
                resource_type: 'image',
                allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
            };
        } else if (file.fieldname === 'video') {
            return {
                folder: 'edupay/videos',
                resource_type: 'video'
            };
        } else {
            // resources (PDFs etc.) — 'raw' preserves the exact file for download
            return {
                folder: 'edupay/resources',
                resource_type: 'raw'
            };
        }
    }
});

module.exports = { cloudinary, storage };
