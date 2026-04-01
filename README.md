# Convo v2 — Private Social Space

## Concept
Convo is a friend-graph-based private social platform. Your **Feed** only shows posts from you and your accepted friends. Two people who aren't mutual friends **cannot** see each other's posts or chat. Private DMs are only available between accepted friends.

## How It Works

### Friend System
- Browse all users in the left sidebar
- Click the **+** icon to send a friend request
- The recipient gets a real-time notification and can Accept or Decline
- Once accepted, you both see each other's feed posts and can DM

### Feed
- Posts are only visible to your mutual friends
- Supports text, photos, videos, and any file attachment
- New posts appear in real-time for all online friends

### Private Chat
- Click any friend to open a private DM
- Supports text + photo/video/file attachments
- Real-time typing indicators
- Full chat history loaded on open

## Project Structure

    Convo/
    ├── data/
    │   ├── users.json         # Registered users
    │   ├── messages.json      # Private DM history
    │   ├── posts.json         # Feed posts
    │   └── friends.json       # Friend relationships
    ├── public/
    │   ├── index.html         # Main app
    │   ├── login.html
    │   ├── register.html
    │   ├── style.css          # Main app styles
    │   ├── auth.css           # Login/Register styles
    │   ├── app.js             # Main client logic
    │   ├── auth.js            # Auth form logic
    │   └── uploads/           # Uploaded files (auto-created)
    ├── server.js
    ├── package.json
    └── README.md

## Setup

```bash
npm install
node server.js
```

Open http://localhost:3000

## Key Differences from v1
- **Friend-graph feed**: posts only visible to mutual friends
- **No chat requests**: replaced with proper friend requests (persistent)  
- **File uploads**: photos, videos, any file in both feed and DMs
- **Real-time online status**: see who's online in the right sidebar
- **Clean dark UI**: Syne + DM Sans fonts, purple accent theme
