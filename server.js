// Convo Server v3

const os      = require('os');
const express = require('express');
const session = require('express-session');
const fs      = require('fs');
const path    = require('path');
const http    = require('http');
const { Server } = require('socket.io');
const multer  = require('multer');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ── Upload Config ────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-z0-9.\-_]/gi, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(session({
  secret: 'convo-secret-2024',
  resave: false, saveUninitialized: false,
  cookie: { secure: false }
}));

// ── Data Paths ───────────────────────────────────────────────
const DATA = path.join(__dirname, 'data');
const FILES = {
  users:         path.join(DATA, 'users.json'),
  messages:      path.join(DATA, 'messages.json'),
  posts:         path.join(DATA, 'posts.json'),
  friends:       path.join(DATA, 'friends.json'),
  notifications: path.join(DATA, 'notifications.json'),
};

// ── JSON Helpers ─────────────────────────────────────────────
function readJSON(p) {
  try { const r = fs.readFileSync(p,'utf8').trim(); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function writeJSON(p, d) {
  fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
}

Object.values(FILES).forEach(f => { if (!fs.existsSync(f)) writeJSON(f, []); });

// ── Auth ─────────────────────────────────────────────────────
const isAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.status(401).json({ success: false, message: 'Unauthorized' });
};

// ── Static ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ── Auth Routes ──────────────────────────────────────────────
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
  let users = readJSON(FILES.users);
  if (users.find(u => u.username === username))
    return res.json({ success: false, message: 'Username already taken.' });
  users.push({ username, password, registeredAt: new Date().toISOString(), notificationsEnabled: true });
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
  if (req.session.user) {
    const users = readJSON(FILES.users);
    const u = users.find(x => x.username === req.session.user.username);
    res.json({ loggedIn: true, username: req.session.user.username, notificationsEnabled: u ? u.notificationsEnabled !== false : true });
  } else res.json({ loggedIn: false });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Users ────────────────────────────────────────────────────
app.get('/users', isAuth, (req, res) => {
  const users = readJSON(FILES.users);
  res.json(users.map(u => ({ username: u.username, registeredAt: u.registeredAt, notificationsEnabled: u.notificationsEnabled !== false })));
});

// Update notification preference
app.post('/notifications/toggle', isAuth, (req, res) => {
  const me = req.session.user.username;
  let users = readJSON(FILES.users);
  const u = users.find(x => x.username === me);
  if (!u) return res.status(404).json({ success: false });
  u.notificationsEnabled = !u.notificationsEnabled;
  writeJSON(FILES.users, users);
  res.json({ success: true, notificationsEnabled: u.notificationsEnabled });
});

// ── Friend System ────────────────────────────────────────────
app.get('/friends', isAuth, (req, res) => {
  const me = req.session.user.username;
  const friends = readJSON(FILES.friends);
  res.json(friends.filter(f => f.status === 'accepted' && (f.from === me || f.to === me))
    .map(f => f.from === me ? f.to : f.from));
});

app.get('/friend-requests', isAuth, (req, res) => {
  const me = req.session.user.username;
  const friends = readJSON(FILES.friends);
  res.json(friends.filter(f => f.to === me && f.status === 'pending').map(f => f.from));
});

app.get('/friends/all', isAuth, (req, res) => {
  const me = req.session.user.username;
  const friends = readJSON(FILES.friends);
  res.json(friends.filter(f => f.from === me || f.to === me));
});

app.post('/friend-request', isAuth, (req, res) => {
  const from = req.session.user.username;
  const { to } = req.body;
  if (from === to) return res.json({ success: false, message: "Can't friend yourself." });
  let friends = readJSON(FILES.friends);
  if (friends.find(f => (f.from === from && f.to === to) || (f.from === to && f.to === from)))
    return res.json({ success: false, message: 'Request already exists.' });
  friends.push({ from, to, status: 'pending', timestamp: new Date().toISOString() });
  writeJSON(FILES.friends, friends);
  const sid = userSockets[to];
  if (sid) io.to(sid).emit('friend-request', { from });
  res.json({ success: true });
});

app.post('/friend-request/respond', isAuth, (req, res) => {
  const me = req.session.user.username;
  const { from, status } = req.body;
  let friends = readJSON(FILES.friends);
  const entry = friends.find(f => f.from === from && f.to === me && f.status === 'pending');
  if (!entry) return res.json({ success: false, message: 'Request not found.' });
  entry.status = status;
  writeJSON(FILES.friends, friends);
  const sid = userSockets[from];
  if (sid) io.to(sid).emit('friend-request-response', { from: me, status });
  res.json({ success: true });
});

function areFriends(a, b) {
  return readJSON(FILES.friends).some(f =>
    f.status === 'accepted' && ((f.from === a && f.to === b) || (f.from === b && f.to === a))
  );
}
function getFriends(username) {
  return readJSON(FILES.friends)
    .filter(f => f.status === 'accepted' && (f.from === username || f.to === username))
    .map(f => f.from === username ? f.to : f.from);
}
function notificationsOn(username) {
  const u = readJSON(FILES.users).find(x => x.username === username);
  return u ? u.notificationsEnabled !== false : true;
}

// ── Notifications ─────────────────────────────────────────────
function pushNotif(to, notif) {
  if (!notificationsOn(to)) return;
  let notifs = readJSON(FILES.notifications);
  const n = { id: Date.now().toString() + Math.random().toString(36).slice(2), to, ...notif, read: false, timestamp: new Date().toISOString() };
  notifs.push(n);
  writeJSON(FILES.notifications, notifs);
  const sid = userSockets[to];
  if (sid) io.to(sid).emit('notification', n);
}

app.get('/notifications', isAuth, (req, res) => {
  const me = req.session.user.username;
  const notifs = readJSON(FILES.notifications).filter(n => n.to === me).reverse();
  res.json(notifs);
});

app.post('/notifications/read-all', isAuth, (req, res) => {
  const me = req.session.user.username;
  let notifs = readJSON(FILES.notifications);
  notifs.forEach(n => { if (n.to === me) n.read = true; });
  writeJSON(FILES.notifications, notifs);
  res.json({ success: true });
});

// ── Feed Posts ───────────────────────────────────────────────
app.get('/posts', isAuth, (req, res) => {
  const me = req.session.user.username;
  const visible = new Set([me, ...getFriends(me)]);
  const posts = readJSON(FILES.posts).filter(p => visible.has(p.username)).reverse();
  res.json(posts);
});

// Like / unlike a post
app.post('/posts/:id/like', isAuth, (req, res) => {
  const me = req.session.user.username;
  let posts = readJSON(FILES.posts);
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ success: false });
  if (!post.likes) post.likes = [];
  const idx = post.likes.indexOf(me);
  let liked;
  if (idx === -1) { post.likes.push(me); liked = true; }
  else            { post.likes.splice(idx, 1); liked = false; }
  writeJSON(FILES.posts, posts);

  // Notify post author (not if liking own post)
  if (liked && post.username !== me) {
    pushNotif(post.username, { from: me, type: 'like', postId: post.id, text: `${me} liked your post` });
  }

  // Broadcast like update to everyone who can see this post
  const recipients = new Set([post.username, ...getFriends(post.username)]);
  recipients.forEach(u => {
    const sid = userSockets[u];
    if (sid) io.to(sid).emit('postLiked', { postId: post.id, likes: post.likes });
  });
  res.json({ success: true, likes: post.likes, liked });
});

// Comment on a post
app.post('/posts/:id/comment', isAuth, (req, res) => {
  const me = req.session.user.username;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ success: false });
  let posts = readJSON(FILES.posts);
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ success: false });
  if (!post.comments) post.comments = [];
  const comment = { id: Date.now().toString(), from: me, text: text.trim(), timestamp: new Date().toISOString() };
  post.comments.push(comment);
  writeJSON(FILES.posts, posts);

  // Notify post author (not if commenting on own post)
  if (post.username !== me) {
    pushNotif(post.username, { from: me, type: 'comment', postId: post.id, text: `${me} commented: "${text.trim().slice(0,40)}"` });
  }

  // Broadcast comment to everyone who can see this post
  const recipients = new Set([post.username, ...getFriends(post.username)]);
  recipients.forEach(u => {
    const sid = userSockets[u];
    if (sid) io.to(sid).emit('postCommented', { postId: post.id, comment });
  });
  res.json({ success: true, comment });
});

// ── Messages ─────────────────────────────────────────────────
app.get('/messages/:user1/:user2', isAuth, (req, res) => {
  const me = req.session.user.username;
  const { user1, user2 } = req.params;
  if (me !== user1 && me !== user2) return res.status(403).json({ success: false });
  if (!areFriends(user1, user2)) return res.status(403).json({ success: false, message: 'Not friends.' });
  const msgs = readJSON(FILES.messages).filter(m =>
    (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1)
  );
  res.json(msgs);
});

// ── Upload ───────────────────────────────────────────────────
app.post('/upload', isAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file.' });
  const url = `/uploads/${req.file.filename}`;
  const mime = req.file.mimetype;
  let type = 'file';
  if (mime.startsWith('image/')) type = 'image';
  else if (mime.startsWith('video/')) type = 'video';
  else if (mime.startsWith('audio/')) type = 'audio';
  res.json({ success: true, url, type, name: req.file.originalname });
});

// ── Network Info ─────────────────────────────────────────────
app.get('/network-info', isAuth, (req, res) => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) ips.push({ name, address: net.address });
  res.json({ port: PORT, ips });
});

// ── Socket.IO ────────────────────────────────────────────────
const userSockets = {};

io.on('connection', (socket) => {
  socket.on('register', (username) => {
    userSockets[username] = socket.id;
    io.emit('online-users', Object.keys(userSockets));
  });

  socket.on('privateMessage', (data) => {
    const { to, message, attachment } = data;
    const from = Object.keys(userSockets).find(k => userSockets[k] === socket.id);
    if (!from || !areFriends(from, to)) return;
    const msg = { from, to, message: message || '', attachment: attachment || null, timestamp: new Date().toISOString() };
    let msgs = readJSON(FILES.messages);
    msgs.push(msg);
    writeJSON(FILES.messages, msgs);
    const sid = userSockets[to];
    if (sid) io.to(sid).emit('privateMessage', msg);
    socket.emit('privateMessage', msg);
  });

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

  socket.on('newPost', (data) => {
    const { content, attachment } = data;
    const username = Object.keys(userSockets).find(k => userSockets[k] === socket.id);
    if (!username) return;
    const post = {
      id: Date.now().toString(), username,
      content: content || '', attachment: attachment || null,
      timestamp: new Date().toISOString(),
      likes: [], comments: []
    };
    let posts = readJSON(FILES.posts);
    posts.push(post);
    writeJSON(FILES.posts, posts);
    const recipients = [username, ...getFriends(username)];
    recipients.forEach(u => { const sid = userSockets[u]; if (sid) io.to(sid).emit('newPost', post); });
  });

  socket.on('disconnect', () => {
    const username = Object.keys(userSockets).find(k => userSockets[k] === socket.id);
    if (username) delete userSockets[username];
    io.emit('online-users', Object.keys(userSockets));
  });
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Convo running!\n   Local:   http://localhost:${PORT}`);
  for (const name of Object.keys(os.networkInterfaces()))
    for (const net of os.networkInterfaces()[name])
      if (net.family === 'IPv4' && !net.internal)
        console.log(`   Network: http://${net.address}:${PORT}  ← share on local WiFi`);
  console.log(`\n   For internet: use ngrok (see README)\n`);
});