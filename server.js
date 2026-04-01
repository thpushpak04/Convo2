// Convo Server

const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── File Upload Config ──────────────────────────────────────
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-z0-9.\-_]/gi, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(session({
  secret: 'convo-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// ── Data File Paths ──────────────────────────────────────────
const DATA = path.join(__dirname, 'data');
const FILES = {
  users:    path.join(DATA, 'users.json'),
  messages: path.join(DATA, 'messages.json'),
  posts:    path.join(DATA, 'posts.json'),
  friends:  path.join(DATA, 'friends.json'),   // { username, friend, status: pending|accepted|declined }
};

// ── Helpers ──────────────────────────────────────────────────
function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Ensure data files exist
Object.values(FILES).forEach(f => { if (!fs.existsSync(f)) writeJSON(f, []); });

// ── Auth Middleware ──────────────────────────────────────────
const isAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.status(401).json({ success: false, message: 'Unauthorized' });
};

// ── Static Files ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ── Auth Routes ──────────────────────────────────────────────
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
  let users = readJSON(FILES.users);
  if (users.find(u => u.username === username))
    return res.json({ success: false, message: 'Username already taken.' });
  users.push({ username, password, registeredAt: new Date().toISOString(), bio: '', avatar: null });
  writeJSON(FILES.users, users);
  res.json({ success: true, message: 'Registered! Please log in.' });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = readJSON(FILES.users);
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.json({ success: false, message: 'Invalid credentials.' });
  req.session.user = { username };
  res.json({ success: true, message: 'Login successful.' });
});

app.get('/session', (req, res) => {
  if (req.session.user) res.json({ loggedIn: true, username: req.session.user.username });
  else res.json({ loggedIn: false });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Users ────────────────────────────────────────────────────
app.get('/users', isAuth, (req, res) => {
  const users = readJSON(FILES.users);
  res.json(users.map(u => ({ username: u.username, registeredAt: u.registeredAt, bio: u.bio, avatar: u.avatar })));
});

// ── Friend System ─────────────────────────────────────────────
// GET friend list (accepted) for current user
app.get('/friends', isAuth, (req, res) => {
  const me = req.session.user.username;
  const friends = readJSON(FILES.friends);
  const myFriends = friends
    .filter(f => f.status === 'accepted' && (f.from === me || f.to === me))
    .map(f => f.from === me ? f.to : f.from);
  res.json(myFriends);
});

// GET pending incoming requests
app.get('/friend-requests', isAuth, (req, res) => {
  const me = req.session.user.username;
  const friends = readJSON(FILES.friends);
  const pending = friends.filter(f => f.to === me && f.status === 'pending').map(f => f.from);
  res.json(pending);
});

// GET all friend data (for UI state)
app.get('/friends/all', isAuth, (req, res) => {
  const me = req.session.user.username;
  const friends = readJSON(FILES.friends);
  const relevant = friends.filter(f => f.from === me || f.to === me);
  res.json(relevant);
});

// POST send friend request
app.post('/friend-request', isAuth, (req, res) => {
  const from = req.session.user.username;
  const { to } = req.body;
  if (from === to) return res.json({ success: false, message: "Can't friend yourself." });
  let friends = readJSON(FILES.friends);
  const exists = friends.find(f =>
    (f.from === from && f.to === to) || (f.from === to && f.to === from)
  );
  if (exists) return res.json({ success: false, message: 'Request already exists.' });
  const req2 = { from, to, status: 'pending', timestamp: new Date().toISOString() };
  friends.push(req2);
  writeJSON(FILES.friends, friends);

  // Notify via socket
  const recipientSid = userSockets[to];
  if (recipientSid) io.to(recipientSid).emit('friend-request', { from });
  res.json({ success: true });
});

// POST respond to friend request
app.post('/friend-request/respond', isAuth, (req, res) => {
  const me = req.session.user.username;
  const { from, status } = req.body; // status: accepted | declined
  let friends = readJSON(FILES.friends);
  const entry = friends.find(f => f.from === from && f.to === me && f.status === 'pending');
  if (!entry) return res.json({ success: false, message: 'Request not found.' });
  entry.status = status;
  writeJSON(FILES.friends, friends);

  const senderSid = userSockets[from];
  if (senderSid) io.to(senderSid).emit('friend-request-response', { from: me, status });
  res.json({ success: true });
});

// Helper: are two users friends?
function areFriends(a, b) {
  const friends = readJSON(FILES.friends);
  return friends.some(f =>
    f.status === 'accepted' && ((f.from === a && f.to === b) || (f.from === b && f.to === a))
  );
}

// Helper: get all friends of a user
function getFriends(username) {
  const friends = readJSON(FILES.friends);
  return friends
    .filter(f => f.status === 'accepted' && (f.from === username || f.to === username))
    .map(f => f.from === username ? f.to : f.from);
}

// ── Feed Posts ───────────────────────────────────────────────
// Feed posts are visible only to mutual friends of the poster.
// A user sees posts from themselves and their friends.
app.get('/posts', isAuth, (req, res) => {
  const me = req.session.user.username;
  const myFriends = getFriends(me);
  const visible = new Set([me, ...myFriends]);
  const posts = readJSON(FILES.posts);
  // Return posts only from visible users
  const filtered = posts.filter(p => visible.has(p.username)).reverse();
  res.json(filtered);
});

// ── Private Messages ─────────────────────────────────────────
app.get('/messages/:user1/:user2', isAuth, (req, res) => {
  const me = req.session.user.username;
  const { user1, user2 } = req.params;
  if (me !== user1 && me !== user2) return res.status(403).json({ success: false });
  if (!areFriends(user1, user2)) return res.status(403).json({ success: false, message: 'Not friends.' });
  const messages = readJSON(FILES.messages);
  const filtered = messages.filter(m =>
    (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1)
  );
  res.json(filtered);
});

// ── File Upload ───────────────────────────────────────────────
app.post('/upload', isAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file.' });
  const url = `/uploads/${req.file.filename}`;
  const mime = req.file.mimetype;
  let type = 'file';
  if (mime.startsWith('image/')) type = 'image';
  else if (mime.startsWith('video/')) type = 'video';
  else if (mime.startsWith('audio/')) type = 'audio';
  res.json({ success: true, url, type, name: req.file.originalname, size: req.file.size });
});

// ── Socket.IO ─────────────────────────────────────────────────
const userSockets = {};

io.on('connection', (socket) => {
  socket.on('register', (username) => {
    userSockets[username] = socket.id;
    io.emit('online-users', Object.keys(userSockets));
  });

  // ── Private Message ──────────────────────────────────────
  socket.on('privateMessage', (data) => {
    const { to, message, attachment } = data;
    const from = Object.keys(userSockets).find(k => userSockets[k] === socket.id);
    if (!from) return;
    if (!areFriends(from, to)) return;

    const msg = { from, to, message: message || '', attachment: attachment || null, timestamp: new Date().toISOString() };
    let messages = readJSON(FILES.messages);
    messages.push(msg);
    writeJSON(FILES.messages, messages);

    const recipSid = userSockets[to];
    if (recipSid) io.to(recipSid).emit('privateMessage', msg);
    socket.emit('privateMessage', msg); // echo to sender too for confirmation
  });

  // ── Typing ──────────────────────────────────────────────
  socket.on('typing', ({ to }) => {
    const from = Object.keys(userSockets).find(k => userSockets[k] === socket.id);
    const sid = userSockets[to];
    if (sid) io.to(sid).emit('typing', { from });
  });

  socket.on('stop-typing', ({ to }) => {
    const from = Object.keys(userSockets).find(k => userSockets[k] === socket.id);
    const sid = userSockets[to];
    if (sid) io.to(sid).emit('stop-typing', { from });
  });

  // ── New Post ─────────────────────────────────────────────
  // Post is broadcast only to the poster's friends
  socket.on('newPost', (data) => {
    const { content, attachment } = data;
    const username = Object.keys(userSockets).find(k => userSockets[k] === socket.id);
    if (!username) return;

    const post = { username, content: content || '', attachment: attachment || null, timestamp: new Date().toISOString(), id: Date.now().toString() };
    let posts = readJSON(FILES.posts);
    posts.push(post);
    writeJSON(FILES.posts, posts);

    // Send to poster + all their friends who are online
    const recipients = [username, ...getFriends(username)];
    recipients.forEach(u => {
      const sid = userSockets[u];
      if (sid) io.to(sid).emit('newPost', post);
    });
  });

  socket.on('disconnect', () => {
    const username = Object.keys(userSockets).find(k => userSockets[k] === socket.id);
    if (username) delete userSockets[username];
    io.emit('online-users', Object.keys(userSockets));
  });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Convo running on http://localhost:${PORT}`));
