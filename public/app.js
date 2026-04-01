// Convo App

document.addEventListener('DOMContentLoaded', async () => {
  const socket = io();

  let currentUser = null;
  let activeChatUser = null;
  let allUsers = [];
  let myFriends = [];
  let pendingRequests = [];
  let allFriendData = [];
  let pendingPostAttachment = null;
  let pendingChatAttachment = null;
  let typingTimer = null;
  let onlineUsers = [];

  // ── Session ────────────────────────────────────────────────
  const session = await fetch('/session').then(r => r.json());
  if (!session.loggedIn) { window.location.href = '/login.html'; return; }
  currentUser = session.username;
  document.getElementById('currentUserName').textContent = currentUser;

  socket.emit('register', currentUser);

  // ── Load Initial Data ──────────────────────────────────────
  async function loadAll() {
    [allUsers, myFriends, pendingRequests, allFriendData] = await Promise.all([
      fetch('/users').then(r => r.json()),
      fetch('/friends').then(r => r.json()),
      fetch('/friend-requests').then(r => r.json()),
      fetch('/friends/all').then(r => r.json()),
    ]);
    renderUserList();
    renderFriendsList();
    renderRequestList();
  }

  async function loadFeed() {
    const posts = await fetch('/posts').then(r => r.json());
    const feed = document.getElementById('postFeed');
    feed.innerHTML = '';
    if (!posts.length) {
      feed.innerHTML = '<div class="empty-state"><i class="fas fa-layer-group"></i><p>Add friends to see their posts here.</p></div>';
      return;
    }
    posts.forEach(p => feed.appendChild(buildPostCard(p)));
  }

  await loadAll();
  await loadFeed();

  // ── Helpers ────────────────────────────────────────────────
  function avatarLetter(name) { return (name || '?')[0].toUpperCase(); }

  function getFriendStatus(username) {
    const entry = allFriendData.find(f =>
      (f.from === currentUser && f.to === username) ||
      (f.from === username && f.to === currentUser)
    );
    if (!entry) return 'none';
    if (entry.status === 'accepted') return 'friends';
    if (entry.status === 'pending' && entry.from === currentUser) return 'sent';
    if (entry.status === 'pending' && entry.to === currentUser) return 'incoming';
    return 'none';
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  function timeAgo(ts) {
    const d = new Date(ts);
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff/60) + 'm ago';
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
    return d.toLocaleDateString();
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Render User List (sidebar left) ───────────────────────
  function renderUserList(filter = '') {
    const ul = document.getElementById('userList');
    ul.innerHTML = '';
    const others = allUsers.filter(u => u.username !== currentUser && u.username.toLowerCase().includes(filter.toLowerCase()));
    if (!others.length) { ul.innerHTML = '<li style="color:var(--muted);font-size:.8rem;padding:8px 10px;">No users found</li>'; return; }
    others.forEach(u => {
      const status = getFriendStatus(u.username);
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="user-avatar">${avatarLetter(u.username)}</div>
        <div class="user-info"><div class="user-name">${u.username}</div></div>
        <div class="user-action-btns">${addBtn(status, u.username)}</div>
      `;
      if (status === 'friends') {
        li.addEventListener('click', (e) => { if (!e.target.closest('button')) openChat(u.username); });
      }
      ul.appendChild(li);
    });
  }

  function addBtn(status, username) {
    if (status === 'friends')   return `<button class="btn-xs add" onclick="openChat('${username}')"><i class="fas fa-comment"></i></button>`;
    if (status === 'sent')      return `<button class="btn-xs pending">Sent</button>`;
    if (status === 'incoming')  return `<button class="btn-xs accept" onclick="respondFriend('${username}','accepted')">Accept</button>`;
    return `<button class="btn-xs add" onclick="sendFriendReq('${username}')"><i class="fas fa-user-plus"></i></button>`;
  }

  // ── Render Friends (right sidebar) ────────────────────────
  function renderFriendsList() {
    const ul = document.getElementById('friendsList');
    ul.innerHTML = '';
    if (!myFriends.length) { ul.innerHTML = '<li style="color:var(--muted);font-size:.8rem;padding:8px 10px;">No friends yet</li>'; return; }
    myFriends.forEach(u => {
      const isOnline = onlineUsers.includes(u);
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="user-avatar" style="${isOnline ? 'box-shadow:0 0 0 2px var(--green)' : ''}">${avatarLetter(u)}</div>
        <div class="user-info"><div class="user-name">${u}</div><div class="user-sub">${isOnline ? '● online' : 'offline'}</div></div>
      `;
      li.addEventListener('click', () => openChat(u));
      ul.appendChild(li);
    });
  }

  // ── Render Requests ────────────────────────────────────────
  function renderRequestList() {
    const ul = document.getElementById('requestList');
    const badge = document.getElementById('requestBadge');
    ul.innerHTML = '';
    if (!pendingRequests.length) {
      badge.style.display = 'none';
      ul.innerHTML = '<li style="color:var(--muted);font-size:.8rem;padding:8px 10px;">None</li>';
      return;
    }
    badge.style.display = 'inline';
    badge.textContent = pendingRequests.length;
    pendingRequests.forEach(from => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="user-avatar">${avatarLetter(from)}</div>
        <div class="user-info"><div class="user-name">${from}</div><div class="user-sub">wants to connect</div></div>
        <div class="user-action-btns">
          <button class="btn-xs accept" onclick="respondFriend('${from}','accepted')">✓</button>
          <button class="btn-xs decline" onclick="respondFriend('${from}','declined')">✕</button>
        </div>
      `;
      ul.appendChild(li);
    });
  }

  // ── Global functions (called from inline HTML) ─────────────
  window.sendFriendReq = async (to) => {
    await fetch('/friend-request', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ to }) });
    toast(`Friend request sent to ${to}`);
    await loadAll();
  };

  window.respondFriend = async (from, status) => {
    await fetch('/friend-request/respond', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ from, status }) });
    if (status === 'accepted') toast(`You and ${from} are now friends!`);
    await loadAll();
    if (status === 'accepted') await loadFeed();
  };

  window.openChat = (username) => {
    activeChatUser = username;
    document.getElementById('chatWithName').textContent = username;
    document.getElementById('chatAvatar').textContent = avatarLetter(username);
    document.getElementById('noChatSelected').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';

    // Mark active in user list
    document.querySelectorAll('#userList li, #friendsList li').forEach(li => li.classList.remove('active'));

    loadChatHistory(username);
    switchTab('chat');
    document.getElementById('chatTabLabel').textContent = `· ${username}`;
  };

  // ── Feed ───────────────────────────────────────────────────
  function buildPostCard(post) {
    const div = document.createElement('div');
    div.className = 'post-card card';
    div.innerHTML = `
      <div class="post-header">
        <div class="user-avatar">${avatarLetter(post.username)}</div>
        <div class="post-meta">
          <div class="post-author">${post.username}</div>
          <div class="post-time">${timeAgo(post.timestamp)}</div>
        </div>
      </div>
      ${post.content ? `<div class="post-body">${escapeHtml(post.content)}</div>` : ''}
      ${post.attachment ? buildAttachmentHTML(post.attachment) : ''}
    `;
    return div;
  }

  function buildAttachmentHTML(att) {
    if (!att) return '';
    if (att.type === 'image') return `<div class="post-attachment"><img src="${att.url}" alt="${escapeHtml(att.name)}" loading="lazy"></div>`;
    if (att.type === 'video') return `<div class="post-attachment"><video src="${att.url}" controls></video></div>`;
    return `<div class="post-attachment"><a href="${att.url}" target="_blank" class="file-link"><i class="fas fa-file"></i>${escapeHtml(att.name)}</a></div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Post attach
  let postAttachFile = null;

  function setupFileInput(inputId, previewId, isPost) {
    const input = document.getElementById(inputId);
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      if (isPost) postAttachFile = file;
      else chatAttachFile = file;
      showPreview(file, previewId, () => {
        if (isPost) postAttachFile = null;
        else chatAttachFile = null;
        document.getElementById(previewId).innerHTML = '';
        input.value = '';
      });
    });
  }

  let chatAttachFile = null;
  setupFileInput('postFile', 'postAttachPreview', true);
  setupFileInput('postFileAny', 'postAttachPreview', true);
  setupFileInput('chatFile', 'chatAttachPreview', false);
  setupFileInput('chatFileAny', 'chatAttachPreview', false);

  function showPreview(file, containerId, onRemove) {
    const c = document.getElementById(containerId);
    c.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'preview-item';
    const rmBtn = document.createElement('button');
    rmBtn.className = 'rm-attach';
    rmBtn.innerHTML = '✕';
    rmBtn.onclick = onRemove;

    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      wrap.appendChild(img);
    } else if (file.type.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.src = URL.createObjectURL(file);
      vid.muted = true;
      wrap.appendChild(vid);
    } else {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.innerHTML = `<i class="fas fa-file"></i><span>${file.name.length > 20 ? file.name.slice(0,18)+'…' : file.name}</span>`;
      wrap.appendChild(chip);
    }
    wrap.appendChild(rmBtn);
    c.appendChild(wrap);
  }

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/upload', { method: 'POST', body: fd });
    return res.json();
  }

  // Post submit
  document.getElementById('postBtn').addEventListener('click', async () => {
    const content = document.getElementById('postContent').value.trim();
    if (!content && !postAttachFile) return;

    let attachment = null;
    if (postAttachFile) {
      const up = await uploadFile(postAttachFile);
      if (up.success) attachment = { url: up.url, type: up.type, name: up.name };
    }

    socket.emit('newPost', { content, attachment });
    document.getElementById('postContent').value = '';
    postAttachFile = null;
    document.getElementById('postAttachPreview').innerHTML = '';
  });

  socket.on('newPost', (post) => {
    const feed = document.getElementById('postFeed');
    const empty = feed.querySelector('.empty-state');
    if (empty) empty.remove();
    feed.insertBefore(buildPostCard(post), feed.firstChild);
  });

  // ── Chat ───────────────────────────────────────────────────
  async function loadChatHistory(username) {
    const msgs = document.getElementById('chatMessages');
    msgs.innerHTML = '';
    try {
      const history = await fetch(`/messages/${currentUser}/${username}`).then(r => r.json());
      if (!Array.isArray(history)) return;
      history.forEach(m => appendMessage(m));
      scrollChat();
    } catch {}
  }

  function appendMessage(msg) {
    const isSelf = msg.from === currentUser;
    const wrap = document.createElement('div');
    wrap.className = `bubble-wrap ${isSelf ? 'self' : 'other'}`;

    let inner = '';
    if (msg.message) inner += escapeHtml(msg.message);
    if (msg.attachment) inner += buildAttachmentHTML(msg.attachment);

    wrap.innerHTML = `
      <div class="bubble ${isSelf ? 'self' : 'other'}">${inner}</div>
      <div class="bubble-time">${formatTime(msg.timestamp)}</div>
    `;
    document.getElementById('chatMessages').appendChild(wrap);
  }

  function scrollChat() {
    const el = document.getElementById('chatMessages');
    el.scrollTop = el.scrollHeight;
  }

  // Send message
  async function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text && !chatAttachFile) return;
    if (!activeChatUser) return;

    let attachment = null;
    if (chatAttachFile) {
      const up = await uploadFile(chatAttachFile);
      if (up.success) attachment = { url: up.url, type: up.type, name: up.name };
      chatAttachFile = null;
      document.getElementById('chatAttachPreview').innerHTML = '';
    }

    socket.emit('privateMessage', { to: activeChatUser, message: text, attachment });
    input.value = '';
    socket.emit('stop-typing', { to: activeChatUser });
    clearTimeout(typingTimer);
  }

  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  document.getElementById('messageInput').addEventListener('input', () => {
    if (!activeChatUser) return;
    socket.emit('typing', { to: activeChatUser });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket.emit('stop-typing', { to: activeChatUser }), 2000);
  });

  socket.on('privateMessage', (data) => {
    if (data.from === currentUser) return; // We already rendered on send for self
    if (data.from === activeChatUser || data.to === activeChatUser) {
      appendMessage(data);
      scrollChat();
    }
    if (data.from !== activeChatUser) toast(`New message from ${data.from}`);
  });

  socket.on('typing', ({ from }) => {
    if (from === activeChatUser) document.getElementById('typingIndicator').style.display = 'block';
  });
  socket.on('stop-typing', ({ from }) => {
    if (from === activeChatUser) document.getElementById('typingIndicator').style.display = 'none';
  });

  // ── Online / Friend events ─────────────────────────────────
  socket.on('online-users', (users) => {
    onlineUsers = users;
    document.getElementById('onlineCount').textContent = users.filter(u => u !== currentUser).length;
    const ol = document.getElementById('onlineList');
    ol.innerHTML = '';
    users.filter(u => u !== currentUser).forEach(u => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="online-dot"></span><div class="user-info"><div class="user-name">${u}</div></div>`;
      ol.appendChild(li);
    });
    renderFriendsList();
  });

  socket.on('friend-request', async ({ from }) => {
    toast(`${from} sent you a friend request!`);
    pendingRequests.push(from);
    await loadAll();
  });

  socket.on('friend-request-response', async ({ from, status }) => {
    if (status === 'accepted') {
      toast(`${from} accepted your request!`);
      await loadAll();
      await loadFeed();
    } else {
      toast(`${from} declined your request.`);
    }
  });

  // ── Tabs ───────────────────────────────────────────────────
  function switchTab(id) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${id}`));
  }

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  // ── Search ─────────────────────────────────────────────────
  document.getElementById('userSearch').addEventListener('input', (e) => {
    renderUserList(e.target.value);
  });

  // ── Logout ─────────────────────────────────────────────────
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
});
