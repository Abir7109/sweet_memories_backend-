const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI;
const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_URL } = process.env;

const corsOptions = {
  origin: [/^https:\/\/[^.]+\.github\.io$/, /^https:\/\/.+\.onrender\.com$/, /^https:\/\/.+\.vercel\.app$/, 'http://localhost:3000'],
  credentials: false
};
app.use(cors(corsOptions));
// Allow larger JSON payloads so base64-encoded images from the frontend don't get rejected
app.use(express.json({ limit: '25mb' }));

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  // Prefer explicit env vars if all three are set
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
} else if (CLOUDINARY_URL) {
  // Fallback: allow Cloudinary to read from CLOUDINARY_URL directly
  cloudinary.config();
} else {
  console.warn('Cloudinary not configured - image uploads will fail.');
}

let cachedDb;
async function getDb() {
  if (cachedDb) return cachedDb;
  if (!MONGODB_URI) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedDb = client.db();
  return cachedDb;
}

app.get('/api/health', async (req, res) => {
  const out = { ok: true };
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    out.mongo = true;
  } catch (e) {
    out.mongo = false;
    out.mongoError = e.message;
  }
  out.cloudinaryConfigured = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
  res.json(out);
});

app.post('/api/upload', async (req, res) => {
  try {
    const { image, folder = 'sweet_memories' } = req.body || {};
    if (!image) return res.status(400).json({ error: 'image is required' });
    if (!CLOUDINARY_CLOUD_NAME && !CLOUDINARY_URL) {
      return res.status(500).json({ error: 'Cloudinary not configured' });
    }
    const uploaded = await cloudinary.uploader.upload(image, { folder });
    res.json({
      url: uploaded.secure_url,
      public_id: uploaded.public_id,
      width: uploaded.width,
      height: uploaded.height
    });
  } catch (err) {
    console.error('upload error', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// Folder/gallery upload helper - used by frontend to store folder photos in Cloudinary
app.post('/api/folder-upload', async (req, res) => {
  try {
    const { image, folderId } = req.body || {};
    if (!image) return res.status(400).json({ error: 'image is required' });
    if (!CLOUDINARY_CLOUD_NAME && !CLOUDINARY_URL) {
      return res.status(500).json({ error: 'Cloudinary not configured' });
    }

    const folder = folderId
      ? `sweet_memories/folders/${folderId}`
      : 'sweet_memories/folders';

    const uploaded = await cloudinary.uploader.upload(image, { folder });

    res.json({
      url: uploaded.secure_url,
      public_id: uploaded.public_id,
      width: uploaded.width,
      height: uploaded.height
    });
  } catch (err) {
    console.error('folder upload error', err);
    res.status(500).json({ error: err.message || 'Folder upload failed' });
  }
});

app.get('/api/memories', async (req, res) => {
  try {
    const db = await getDb();
    const items = await db.collection('memories')
      .find({})
      .sort({ date: -1, createdAt: -1 })
      .toArray();
    res.json(items);
  } catch (err) {
    console.error('list memories error', err);
    res.status(500).json({ error: err.message || 'Failed to fetch memories' });
  }
});

app.post('/api/memories', async (req, res) => {
  try {
    const { title, date, description, tag, image } = req.body || {};
    if (!(title && date && description && tag)) {
      return res.status(400).json({ error: 'title, date, description, tag are required' });
    }
    let imageUrl = null;
    let cloudinaryId = null;
    if (image) {
      if (!CLOUDINARY_CLOUD_NAME) return res.status(500).json({ error: 'Cloudinary not configured' });
      const uploaded = await cloudinary.uploader.upload(image, { folder: 'sweet_memories/memories' });
      imageUrl = uploaded.secure_url;
      cloudinaryId = uploaded.public_id;
    }
    const db = await getDb();
    const doc = { title, date, description, tag, image: imageUrl, cloudinaryId, favorite: false, createdAt: new Date() };
    const result = await db.collection('memories').insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  } catch (err) {
    console.error('create memory error', err);
    res.status(500).json({ error: err.message || 'Failed to create memory' });
  }
});

app.patch('/api/memories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { favorite } = req.body || {};
    const db = await getDb();
    await db.collection('memories').updateOne({ _id: new ObjectId(id) }, { $set: { favorite: !!favorite } });
    const updated = await db.collection('memories').findOne({ _id: new ObjectId(id) });
    res.json(updated);
  } catch (err) {
    console.error('update memory error', err);
    res.status(500).json({ error: err.message || 'Failed to update memory' });
  }
});

app.delete('/api/memories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const existing = await db.collection('memories').findOne({ _id: new ObjectId(id) });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await db.collection('memories').deleteOne({ _id: new ObjectId(id) });
    if (existing.cloudinaryId && CLOUDINARY_CLOUD_NAME) {
      try { await cloudinary.uploader.destroy(existing.cloudinaryId); } catch (e) { console.warn('cloudinary destroy failed', e.message); }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('delete memory error', err);
    res.status(500).json({ error: err.message || 'Failed to delete memory' });
  }
});

app.get('/api/guestbook', async (req, res) => {
  try {
    const db = await getDb();
    const items = await db.collection('guestbook').find({}).sort({ createdAt: -1 }).toArray();
    res.json(items);
  } catch (err) {
    console.error('list guestbook error', err);
    res.status(500).json({ error: err.message || 'Failed to fetch guestbook entries' });
  }
});

app.post('/api/guestbook', async (req, res) => {
  try {
    const { name, message } = req.body || {};
    if (!(name && message)) return res.status(400).json({ error: 'name and message are required' });
    const db = await getDb();
    const doc = { name, message, createdAt: new Date() };
    const result = await db.collection('guestbook').insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  } catch (err) {
    console.error('create guestbook error', err);
    res.status(500).json({ error: err.message || 'Failed to add guestbook entry' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
