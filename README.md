# Sweet Memories Backend

Express API for MongoDB + Cloudinary

Endpoints
- GET /api/health
- POST /api/upload { image: base64 }
- GET /api/memories
- POST /api/memories { title, date, description, tag, image? }
- PATCH /api/memories/:id { favorite }
- DELETE /api/memories/:id
- GET /api/guestbook
- POST /api/guestbook { name, message }

Run locally
1) Copy .env.example to .env and fill values
2) npm install
3) npm start

Deploy to Render
- Build: npm install
- Start: node index.js
- Env vars: MONGODB_URI, CLOUDINARY_*
