import { list } from '@vercel/blob';
const token = process.env.BLOB_READ_WRITE_TOKEN;
const { blobs } = await list({ prefix: 'photos/', limit: 300, token });
blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
for (const b of blobs.slice(0, 14)) console.log(b.uploadedAt, Math.round(b.size / 1024) + 'KB', b.pathname, b.url);
