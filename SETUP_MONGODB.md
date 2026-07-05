# Switching to MongoDB Atlas — setup steps

This folder is your project, already converted to use MongoDB instead of `db.json`
for reads/writes going forward. Follow these steps in order so you don't lose any
existing data.

## 1. Create your free Atlas cluster
1. Go to https://mongodb.com/cloud/atlas and sign up (no card needed for the free tier).
2. Create a Project, then a free **M0** Cluster.
3. Database Access → add a database user (username + password) — save these.
4. Network Access → Add IP Address → Allow Access From Anywhere (`0.0.0.0/0`).
5. Connect → Drivers → Node.js → copy the connection string.

## 2. Configure this project
1. Copy `.env.example` to `.env`.
2. Paste your connection string into `MONGO_URI`, filling in your username/password
   and adding a database name before the `?`, e.g.:
   ```
   MONGO_URI=mongodb+srv://myuser:mypass@cluster0.abcde.mongodb.net/edupay?retryWrites=true&w=majority
   ```

## 3. Install dependencies
```bash
npm install
```

## 4. Migrate your existing data (one time only)
Your current `db.json` is already copied into this folder. Run:
```bash
npm run migrate
```
This reads `db.json` and inserts every user, course, lecture, resource, order, and
chat message into your new Atlas cluster. It also hashes plaintext passwords with
bcrypt while migrating — so your users' passwords will finally be stored securely.

You should see console output confirming how many records of each type were
migrated. Go check the **Collections** tab in Atlas to confirm everything is there.

**Do not run `npm run migrate` a second time** against the same cluster — it will
refuse to run if it detects existing users, to avoid creating duplicates.

## 5. Start the server
```bash
npm start
```
Open http://localhost:3000 — the app now reads/writes MongoDB instead of `db.json`.
Log in with your existing accounts exactly as before (e.g. `admin@example.com` /
`admin123`) — the passwords still work, they're just hashed on the backend now.

## 6. Once you've confirmed everything works
You can delete `db.json` from the project — it's no longer read by `server.js`
(only `migrate.js` uses it, and only once).

---

# Part 2: Cloudinary for videos, thumbnails, and PDFs

`server.js` now uploads new files (course thumbnails, lecture videos, resource
PDFs) straight to Cloudinary instead of local disk. Cloudinary's free tier gives
you 25GB storage and 25GB monthly bandwidth, and supports video.

## 1. Create a free Cloudinary account
1. Go to https://cloudinary.com/users/register/free and sign up (no card required).
2. On your Dashboard, you'll see **Cloud name**, **API Key**, and **API Secret**.

## 2. Add credentials to `.env`
Add these three lines (already present as placeholders in `.env.example`):
```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

## 3. Install the new dependencies
```bash
npm install
```
This pulls in `cloudinary` and `multer-storage-cloudinary`, which are now used
in `config/cloudinary.js` and `server.js`.

## 4. Move your EXISTING local files up to Cloudinary
If you already had videos/thumbnails/PDFs sitting in your local `/uploads`
folder before making this switch (i.e. you're not starting fresh), run:
```bash
npm run migrate-uploads
```
This script:
- Looks at every course/lecture/resource in MongoDB
- For any whose file path still points to local disk (e.g. `/uploads/videos/xyz.mp4`),
  uploads that local file to Cloudinary and updates the record with the new
  Cloudinary URL
- Skips anything already pointing to Cloudinary, so it's safe to re-run
- Leaves a warning (and doesn't touch the record) for anything it can't find
  locally, so you never lose a working reference

Make sure your local `/uploads` folder (with the actual files) is present in
the project when you run this — it reads directly from disk.

## 5. From now on
Every new course thumbnail, lecture video, and resource PDF uploaded through
the app goes straight to Cloudinary automatically — nothing else to do. You can
deploy to any free host (even ones that wipe local disk on every restart)
without losing files, because nothing important lives on that host's disk
anymore — only MongoDB Atlas (data) and Cloudinary (files).

Once you've confirmed the migrated files play/open correctly from their new
Cloudinary URLs, you can delete the local `/uploads` folder.
