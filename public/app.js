document.addEventListener('DOMContentLoaded', async () => {
  const socket = io();

  let currentUser = null;
  let activeChatUser = null;
  let allUsers = [];
  let myFriends = [];
  let pendingRequests = [];
  let allFriendData = [];
  let typingTimer = null;
  let onlineUsers = [];
  let postAttachFile = null;
  let chatAttachFile = null;

  const themeToggle = document.getElementById('themeToggle');
  const mobileNavOverlay = document.getElementById('mobileNavOverlay');
  const navDock = document.getElementById('navDock');
  const chatLayout = document.querySelector('.chat-layout');
  const chatView = document.getElementById('chatView');
  const noChatSelected = document.getElementById('noChatSelected');

  applySavedTheme();

  const session = await fetch('/session').then((r) => r.json());
  if (!session.loggedIn) {
    window.location.href = '/login.html';
    return;
  }

  currentUser = session.username;
  document.getElementById('currentUserName').textContent = currentUser;
  document.getElementById('currentUserDock').textContent = currentUser;

  socket.emit('register', currentUser);

  async function loadAll() {
    [allUsers, myFriends, pendingRequests, allFriendData] = await Promise.all([
      fetch('/users').then((r) => r.json()),
      fetch('/friends').then((r) => r.json()),
      fetch('/friend-requests').then((r) => r.json()),
      fetch('/friends/all').then((r) => r.json())
    ]);

    updateCounters();
    renderUserList();
    renderFriendsLists();
    renderRequestList();
  }

  async function loadFeed() {
    const posts = await fetch('/posts').then((r) => r.json());
    const feed = document.getElementById('postFeed');
    feed.innerHTML = '';

    if (!posts.length) {
      feed.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-newspaper"></i>
          <p>Add friends to see and share posts here.</p>
        </div>
      `;
      return;
    }

    posts.forEach((post) => feed.appendChild(buildPostCard(post)));
  }

  await loadAll();
  await loadFeed();
  updateViewCopy('convo');

  function applySavedTheme() {
    const theme = localStorage.getItem('convo-theme') === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    themeToggle.innerHTML = theme === 'dark'
      ? '<i class="fas fa-sun"></i>'
      : '<i class="fas fa-moon"></i>';
  }

  function toggleTheme() {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('convo-theme', nextTheme);
    applySavedTheme();
  }

  function openMobileNav() {
    navDock.classList.add('open');
    mobileNavOverlay.classList.add('show');
  }

  function closeMobileNav() {
    navDock.classList.remove('open');
    mobileNavOverlay.classList.remove('show');
  }

  function avatarLetter(name) {
    return (name || '?').charAt(0).toUpperCase();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(ts) {
    const date = new Date(ts);
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  function getFriendStatus(username) {
    const entry = allFriendData.find((item) =>
      (item.from === currentUser && item.to === username) ||
      (item.from === username && item.to === currentUser)
    );
    if (!entry) return 'none';
    if (entry.status === 'accepted') return 'friends';
    if (entry.status === 'pending' && entry.from === currentUser) return 'sent';
    if (entry.status === 'pending' && entry.to === currentUser) return 'incoming';
    return 'none';
  }

  function updateCounters() {
    document.getElementById('friendCountCard').textContent = myFriends.length;
    document.getElementById('friendCountPill').textContent = myFriends.length;
    document.getElementById('requestCountCard').textContent = pendingRequests.length;
    document.getElementById('onlineCount').textContent = onlineUsers.filter((u) => u !== currentUser).length;

    const requestBadge = document.getElementById('requestBadge');
    const navRequestBadge = document.getElementById('navRequestBadge');
    if (pendingRequests.length) {
      requestBadge.style.display = 'inline-flex';
      navRequestBadge.style.display = 'inline-flex';
      requestBadge.textContent = pendingRequests.length;
      navRequestBadge.textContent = pendingRequests.length;
    } else {
      requestBadge.style.display = 'none';
      navRequestBadge.style.display = 'none';
    }
  }

  function updateViewCopy(view) {
    const title = document.getElementById('viewTitle');
    const subtitle = document.getElementById('viewSubtitle');
    const copy = {
      convo: ['Convo', 'Overview of your social space and quick shortcuts.'],
      people: ['People', 'Search users and manage your friend list in one window.'],
      requests: ['Requests', 'Review incoming friend requests.'],
      feed: ['Feed', 'Create posts and react with like, comment, or support.'],
      chat: ['Chat', activeChatUser ? `Private conversation with ${activeChatUser}.` : 'Select a friend to start chatting.']
    };

    title.textContent = copy[view][0];
    subtitle.textContent = copy[view][1];
  }

  function switchView(view) {
    document.querySelectorAll('.view-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.view === view);
    });
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.viewTarget === view);
    });
    updateViewCopy(view);
    closeMobileNav();
  }

  function renderListEmpty(targetId, text) {
    document.getElementById(targetId).innerHTML = `<li class="list-empty">${text}</li>`;
  }

  function userRowMarkup(username, subtitle, actions, isActive = false, online = false) {
    return `
      <div class="person-row${isActive ? ' active' : ''}">
        <div class="person-avatar"${online ? ' style="box-shadow: 0 0 0 0.2rem var(--good-soft);"' : ''}>${avatarLetter(username)}</div>
        <div class="person-info">
          <div class="person-name">${escapeHtml(username)}</div>
          ${subtitle ? `<div class="person-sub">${subtitle}</div>` : ''}
        </div>
        ${actions ? `<div class="person-actions">${actions}</div>` : ''}
      </div>
    `;
  }

  function friendActionMarkup(username) {
    return `<button class="mini-btn blue" type="button" data-open-chat="${escapeHtml(username)}">Chat</button>`;
  }

  function addBtn(status, username) {
    if (status === 'friends') return friendActionMarkup(username);
    if (status === 'sent') return '<button class="mini-btn soft" type="button" disabled>Sent</button>';
    if (status === 'incoming') {
      return `<button class="mini-btn green" type="button" data-respond-friend="${escapeHtml(username)}" data-status="accepted">Accept</button>`;
    }
    return `<button class="mini-btn blue" type="button" data-send-friend="${escapeHtml(username)}">Add</button>`;
  }

  function renderUserList(filter = '') {
    const ul = document.getElementById('userList');
    ul.innerHTML = '';

    const others = allUsers.filter((user) =>
      user.username !== currentUser && user.username.toLowerCase().includes(filter.toLowerCase())
    );

    if (!others.length) {
      renderListEmpty('userList', 'No users found.');
      return;
    }

    others.forEach((user) => {
      const status = getFriendStatus(user.username);
      const li = document.createElement('li');
      li.innerHTML = userRowMarkup(
        user.username,
        status === 'friends' ? 'Already in your circle' : 'Available to connect',
        addBtn(status, user.username),
        activeChatUser === user.username,
        onlineUsers.includes(user.username)
      );
      li.querySelector('.person-row').addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        if (status === 'friends') openChat(user.username);
      });
      ul.appendChild(li);
    });
  }

  function renderFriendsLists() {
    [
      { id: 'friendsListHome', empty: 'No friends yet.' },
      { id: 'friendsListPeople', empty: 'No friends yet.' },
      { id: 'friendsListChat', empty: 'Add friends to start chatting.' }
    ].forEach(({ id, empty }) => {
      const ul = document.getElementById(id);
      ul.innerHTML = '';

      if (!myFriends.length) {
        renderListEmpty(id, empty);
        return;
      }

      myFriends.forEach((friend) => {
        const isOnline = onlineUsers.includes(friend);
        const li = document.createElement('li');
        li.innerHTML = userRowMarkup(
          friend,
          isOnline ? 'Online now' : 'Offline',
          id === 'friendsListHome' ? '' : friendActionMarkup(friend),
          activeChatUser === friend,
          isOnline
        );
        li.querySelector('.person-row').addEventListener('click', (event) => {
          if (event.target.closest('button')) return;
          openChat(friend);
        });
        ul.appendChild(li);
      });
    });
  }

  function renderRequestList() {
    const ul = document.getElementById('requestList');
    ul.innerHTML = '';

    if (!pendingRequests.length) {
      renderListEmpty('requestList', 'No pending requests.');
      return;
    }

    pendingRequests.forEach((from) => {
      const li = document.createElement('li');
      li.innerHTML = userRowMarkup(
        from,
        'Wants to connect with you',
        `
          <button class="mini-btn green" type="button" data-respond-friend="${escapeHtml(from)}" data-status="accepted">Accept</button>
          <button class="mini-btn" type="button" data-respond-friend="${escapeHtml(from)}" data-status="declined">Decline</button>
        `
      );
      ul.appendChild(li);
    });
  }

  function renderOnlineList() {
    const ul = document.getElementById('onlineList');
    ul.innerHTML = '';
    const others = onlineUsers.filter((user) => user !== currentUser);

    if (!others.length) {
      renderListEmpty('onlineList', 'No one else is online right now.');
      return;
    }

    others.forEach((username) => {
      const li = document.createElement('li');
      li.innerHTML = userRowMarkup(username, 'Available now', '', false, true);
      ul.appendChild(li);
    });
  }

  async function sendFriendReq(to) {
    const res = await fetch('/friend-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to })
    });
    const data = await res.json();
    toast(data.success ? `Friend request sent to ${to}` : (data.message || 'Could not send request.'));
    await loadAll();
  }

  async function respondFriend(from, status) {
    const res = await fetch('/friend-request/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, status })
    });
    const data = await res.json();
    if (!data.success) {
      toast(data.message || 'Could not update request.');
      return;
    }
    if (status === 'accepted') {
      toast(`You and ${from} are now friends.`);
      await loadFeed();
    } else {
      toast(`Request from ${from} declined.`);
    }
    await loadAll();
  }

  function buildAttachmentHTML(att) {
    if (!att) return '';
    if (att.type === 'image') return `<div class="post-attachment"><img src="${att.url}" alt="${escapeHtml(att.name)}" loading="lazy"></div>`;
    if (att.type === 'video') return `<div class="post-attachment"><video src="${att.url}" controls></video></div>`;
    return `
      <div class="post-attachment">
        <a href="${att.url}" target="_blank" class="file-link" rel="noreferrer">
          <i class="fas fa-file"></i>
          <span>${escapeHtml(att.name)}</span>
        </a>
      </div>
    `;
  }

  function buildCommentMarkup(comment) {
    return `
      <div class="comment-item">
        <div class="comment-meta">${escapeHtml(comment.from)} · ${timeAgo(comment.timestamp)}</div>
        <div>${escapeHtml(comment.text)}</div>
      </div>
    `;
  }

  function buildPostCard(post) {
    const div = document.createElement('article');
    const likes = Array.isArray(post.likes) ? post.likes : [];
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const liked = likes.includes(currentUser);

    div.className = 'post-card';
    div.dataset.postId = post.id;
    div.innerHTML = `
      <div class="post-header">
        <div class="person-avatar">${avatarLetter(post.username)}</div>
        <div class="post-meta">
          <div class="post-author">${escapeHtml(post.username)}</div>
          <div class="post-time">${timeAgo(post.timestamp)}</div>
        </div>
      </div>
      ${post.content ? `<div class="post-body">${escapeHtml(post.content)}</div>` : ''}
      ${post.attachment ? buildAttachmentHTML(post.attachment) : ''}
      <div class="post-actions">
        <button class="post-action-btn${liked ? ' active' : ''}" type="button" data-post-like="${post.id}">
          <i class="fas fa-thumbs-up"></i>
          <span>Like ${likes.length ? `(${likes.length})` : ''}</span>
        </button>
        <button class="post-action-btn" type="button" data-post-comments="${post.id}">
          <i class="fas fa-comment"></i>
          <span>Comment ${comments.length ? `(${comments.length})` : ''}</span>
        </button>
        <button class="post-action-btn${liked ? ' active' : ''}" type="button" data-post-support="${post.id}">
          <i class="fas fa-heart"></i>
          <span>Support</span>
        </button>
      </div>
      <div class="post-comments" id="comments-${post.id}">
        <div class="comment-list">
          ${comments.length ? comments.map(buildCommentMarkup).join('') : '<div class="list-empty">No comments yet.</div>'}
        </div>
        <form class="comment-form" data-comment-form="${post.id}">
          <input type="text" placeholder="Write a comment..." maxlength="300">
          <button class="primary-btn" type="submit">Send</button>
        </form>
      </div>
    `;
    return div;
  }

  async function togglePostLike(postId) {
    const res = await fetch(`/posts/${postId}/like`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) {
      toast('Could not update post reaction.');
      return;
    }
    updatePostLikes(postId, data.likes);
  }

  function updatePostLikes(postId, likes) {
    const postCard = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postCard) return;

    const liked = likes.includes(currentUser);
    const likeBtn = postCard.querySelector(`[data-post-like="${postId}"]`);
    const supportBtn = postCard.querySelector(`[data-post-support="${postId}"]`);

    likeBtn.classList.toggle('active', liked);
    supportBtn.classList.toggle('active', liked);
    likeBtn.querySelector('span').textContent = `Like ${likes.length ? `(${likes.length})` : ''}`.trim();
  }

  function updatePostComments(postId, comment) {
    const postCard = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postCard) return;

    const commentWrap = postCard.querySelector('.comment-list');
    const placeholder = commentWrap.querySelector('.list-empty');
    if (placeholder) placeholder.remove();
    commentWrap.insertAdjacentHTML('beforeend', buildCommentMarkup(comment));

    const commentLabel = postCard.querySelector(`[data-post-comments="${postId}"] span`);
    const match = commentLabel.textContent.match(/\((\d+)\)/);
    const count = match ? Number(match[1]) + 1 : 1;
    commentLabel.textContent = `Comment (${count})`;
  }

  async function submitComment(postId, text) {
    const res = await fetch(`/posts/${postId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!data.success) {
      toast('Could not add comment.');
      return false;
    }
    return true;
  }

  function showPreview(file, containerId, onRemove) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'preview-item';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'rm-attach';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', onRemove);

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
      chip.innerHTML = `<i class="fas fa-file"></i><span>${escapeHtml(file.name)}</span>`;
      wrap.appendChild(chip);
    }

    wrap.appendChild(removeButton);
    container.appendChild(wrap);
  }

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

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/upload', { method: 'POST', body: fd });
    return res.json();
  }

  async function loadChatHistory(username) {
    const messages = document.getElementById('chatMessages');
    messages.innerHTML = '';
    try {
      const history = await fetch(`/messages/${currentUser}/${username}`).then((r) => r.json());
      if (!Array.isArray(history)) return;
      history.forEach((message) => appendMessage(message));
      scrollChat();
    } catch {
      toast('Could not load chat history.');
    }
  }

  function appendMessage(message) {
    const isSelf = message.from === currentUser;
    const wrap = document.createElement('div');
    wrap.className = `bubble-wrap ${isSelf ? 'self' : 'other'}`;

    let inner = '';
    if (message.message) inner += escapeHtml(message.message);
    if (message.attachment) inner += buildAttachmentHTML(message.attachment);

    wrap.innerHTML = `
      <div class="bubble ${isSelf ? 'self' : 'other'}">${inner}</div>
      <div class="bubble-time">${formatTime(message.timestamp)}</div>
    `;
    document.getElementById('chatMessages').appendChild(wrap);
  }

  function scrollChat() {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function highlightActiveChat() {
    document.querySelectorAll('#friendsListPeople .person-row, #friendsListChat .person-row, #userList .person-row').forEach((row) => {
      const name = row.querySelector('.person-name')?.textContent;
      row.classList.toggle('active', !!name && name === activeChatUser);
    });
  }

  function openChat(username) {
    activeChatUser = username;
    document.getElementById('chatWithName').textContent = username;
    document.getElementById('chatAvatar').textContent = avatarLetter(username);
    noChatSelected.style.display = 'none';
    chatView.style.display = 'flex';
    chatLayout.classList.add('chat-open');
    loadChatHistory(username);
    switchView('chat');
    highlightActiveChat();
    updateViewCopy('chat');
  }

  async function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text && !chatAttachFile) return;
    if (!activeChatUser) return;

    let attachment = null;
    if (chatAttachFile) {
      const upload = await uploadFile(chatAttachFile);
      if (upload.success) attachment = { url: upload.url, type: upload.type, name: upload.name };
      chatAttachFile = null;
      document.getElementById('chatAttachPreview').innerHTML = '';
      document.getElementById('chatFile').value = '';
      document.getElementById('chatFileAny').value = '';
    }

    socket.emit('privateMessage', { to: activeChatUser, message: text, attachment });
    input.value = '';
    socket.emit('stop-typing', { to: activeChatUser });
    clearTimeout(typingTimer);
  }

  setupFileInput('postFile', 'postAttachPreview', true);
  setupFileInput('postFileAny', 'postAttachPreview', true);
  setupFileInput('chatFile', 'chatAttachPreview', false);
  setupFileInput('chatFileAny', 'chatAttachPreview', false);

  document.getElementById('postBtn').addEventListener('click', async () => {
    const content = document.getElementById('postContent').value.trim();
    if (!content && !postAttachFile) return;

    let attachment = null;
    if (postAttachFile) {
      const upload = await uploadFile(postAttachFile);
      if (upload.success) attachment = { url: upload.url, type: upload.type, name: upload.name };
    }

    socket.emit('newPost', { content, attachment });
    document.getElementById('postContent').value = '';
    postAttachFile = null;
    document.getElementById('postAttachPreview').innerHTML = '';
    document.getElementById('postFile').value = '';
    document.getElementById('postFileAny').value = '';
  });

  document.getElementById('postFeed').addEventListener('click', async (event) => {
    const likeButton = event.target.closest('[data-post-like]');
    const commentToggle = event.target.closest('[data-post-comments]');
    const supportButton = event.target.closest('[data-post-support]');

    if (likeButton) {
      await togglePostLike(likeButton.dataset.postLike);
      return;
    }
    if (supportButton) {
      await togglePostLike(supportButton.dataset.postSupport);
      return;
    }
    if (commentToggle) {
      document.getElementById(`comments-${commentToggle.dataset.postComments}`).classList.toggle('open');
    }
  });

  document.getElementById('postFeed').addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-comment-form]');
    if (!form) return;
    event.preventDefault();

    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text) return;

    const success = await submitComment(form.dataset.commentForm, text);
    if (success) input.value = '';
  });

  document.addEventListener('click', async (event) => {
    const navButton = event.target.closest('[data-view-target]');
    if (navButton) {
      switchView(navButton.dataset.viewTarget);
      return;
    }

    const shortcut = event.target.closest('[data-go-view]');
    if (shortcut) {
      switchView(shortcut.dataset.goView);
      return;
    }

    const addButton = event.target.closest('[data-send-friend]');
    if (addButton) {
      await sendFriendReq(addButton.dataset.sendFriend);
      return;
    }

    const respondButton = event.target.closest('[data-respond-friend]');
    if (respondButton) {
      await respondFriend(respondButton.dataset.respondFriend, respondButton.dataset.status);
      return;
    }

    const openChatButton = event.target.closest('[data-open-chat]');
    if (openChatButton) openChat(openChatButton.dataset.openChat);
  });

  document.getElementById('messageInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  document.getElementById('messageInput').addEventListener('input', () => {
    if (!activeChatUser) return;
    socket.emit('typing', { to: activeChatUser });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket.emit('stop-typing', { to: activeChatUser }), 2000);
  });

  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('userSearch').addEventListener('input', (event) => renderUserList(event.target.value));
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('mobileNavToggle').addEventListener('click', openMobileNav);
  document.getElementById('mobileNavClose').addEventListener('click', closeMobileNav);
  mobileNavOverlay.addEventListener('click', closeMobileNav);

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  document.getElementById('chatBackBtn').addEventListener('click', () => {
    chatLayout.classList.remove('chat-open');
  });

  socket.on('newPost', (post) => {
    const feed = document.getElementById('postFeed');
    const empty = feed.querySelector('.empty-state');
    if (empty) empty.remove();
    feed.insertBefore(buildPostCard(post), feed.firstChild);
  });

  socket.on('postLiked', ({ postId, likes }) => updatePostLikes(postId, likes));
  socket.on('postCommented', ({ postId, comment }) => updatePostComments(postId, comment));

  socket.on('privateMessage', (data) => {
    if (data.from === currentUser) {
      appendMessage(data);
      scrollChat();
      return;
    }
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

  socket.on('online-users', (users) => {
    onlineUsers = users;
    updateCounters();
    renderOnlineList();
    renderFriendsLists();
    renderUserList(document.getElementById('userSearch').value);
  });

  socket.on('friend-request', async ({ from }) => {
    toast(`${from} sent you a friend request.`);
    await loadAll();
  });

  socket.on('friend-request-response', async ({ from, status }) => {
    toast(status === 'accepted' ? `${from} accepted your request.` : `${from} declined your request.`);
    if (status === 'accepted') await loadFeed();
    await loadAll();
  });
});
