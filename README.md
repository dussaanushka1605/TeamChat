# Mini Team Chat Application (Slack-like)

A full-stack real-time team chat application where users can communicate in channels with instant messaging, presence tracking, and message management features.

## 🚀 Live Application

- **Frontend:** [https://teamchatroom.netlify.app/](https://teamchatroom.netlify.app/)
- **Backend API:** [https://teamchat-1-llwr.onrender.com](https://teamchat-1-llwr.onrender.com)

## Overview

This is a complete full-stack project implementing:

- ✅ Real-time messaging
- ✅ Channels (groups)
- ✅ User authentication
- ✅ Online/offline presence
- ✅ Message history with pagination support
- ✅ Deployed, publicly accessible application

## Core Requirements

### User Accounts
- Users can sign up and log in
- Authentication implemented using JWT tokens
- Users remain logged in on page refresh (sessionStorage)

### Channels
Users can:
- View existing channels
- Create new channels
- Join channels using channel codes
- Leave channels

Channel information displayed:
- Channel name
- Member count
- Member list with online/offline status

### Real-Time Messaging
- Messages appear instantly to all users in the same channel
- Implemented using Socket.io (WebSockets)
- Every message is stored in MongoDB database

Message structure includes:
- Sender user information
- Channel (groupId)
- Text content
- Timestamp

### Online Status (Presence)
- Shows which users are currently online
- Presence tracking works across multiple browser tabs and users
- Real-time updates via Socket.io
- Graceful disconnect handling (8-second grace period)
- Last active timestamp for offline users

### Message History & Pagination
- When opening a channel, recent messages are loaded
- API supports pagination with `limit` and `skip` parameters
- Messages are sorted by creation time (oldest first)

### Frontend Interface
Clean and functional interface providing:
- Channel list view
- Channel creation dialog
- Channel joining via code
- Chat history display
- Message input with emoji picker
- Online/offline indicators in members panel
- Real-time message updates

## Optional Features Implemented

The following optional features have been implemented:

- ✅ **Message editing** - Users can edit their own messages with real-time updates
- ✅ **Message deletion** - Users can delete their own messages with real-time removal
- ✅ **Typing indicators** - Shows when users are typing in a channel
- ✅ **Channel themes** - 8 customizable color themes per channel
- ✅ **Disappearing messages** - Auto-delete messages after specified time
- ✅ **Emoji picker** - Rich emoji selection for messages
- ✅ **File sharing** - Upload and share text files (.txt, .md, .json, code files)
- ✅ **User blocking** - Block/unblock users to prevent messaging
- ✅ **User reporting** - Report users for inappropriate behavior

## Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Socket.io** - Real-time bidirectional communication
- **MongoDB** (Mongoose) - NoSQL database
- **JWT** (jsonwebtoken) - Authentication tokens
- **bcryptjs** - Password hashing
- **CORS** - Cross-origin resource sharing
- **dotenv** - Environment variable management
- **uuid** - Unique identifier generation

### Frontend
- **Next.js 14** - React framework with App Router
- **React 18** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first CSS framework
- **Socket.io Client** - Real-time communication
- **Axios** - HTTP client
- **Radix UI** - Accessible component primitives
- **Lucide React** - Icon library
- **Sonner** - Toast notifications
- **Emoji Picker React** - Emoji selection

### Database
- **MongoDB Atlas** - Cloud-hosted MongoDB database

## Setup & Run Instructions

### Prerequisites

- Node.js 18+ installed
- MongoDB Atlas account (or local MongoDB instance)
- npm or yarn package manager

### Step 1: Clone the Repository

```bash
git clone https://github.com/dussaanushka1605/TeamChat.git
cd TeamChat
```

### Step 2: Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the `backend` directory:
```env
PORT=5001
MONGO_URI=your_mongodb_atlas_connection_string_here
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
FRONTEND_URL=http://localhost:3000
```

4. Replace `MONGO_URI` with your MongoDB Atlas connection string.

5. Start the backend server:
```bash
npm start
```

**OR** for development with auto-reload:
```bash
npm run dev
```

The backend will run on `http://localhost:5001`

**OR** use the batch file (Windows):
```bash
start-backend.bat
```

### Step 3: Frontend Setup

1. Open a **new terminal** and navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the `frontend` directory:
```env
NEXT_PUBLIC_API_URL=http://localhost:5001
```

4. Start the development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:3000`

**OR** use the batch file (Windows):
```bash
start-frontend.bat
```

### Step 4: Access the Application

1. Open your browser and navigate to: `http://localhost:3000`

2. **Sign Up:** Create a new account with name, email, and password

3. **Login:** Use your credentials to log in

4. **Create/Join Channels:** Start chatting!

## Assumptions & Limitations

### Assumptions
- Authentication tokens stored in `sessionStorage` (per-tab isolation)
- MongoDB Atlas is used for database hosting
- Socket.io WebSocket transport is preferred
- File uploads limited to text-based files for security
- Users must join channels using channel codes

### Limitations
- File sharing supports text files only (.txt, .md, .json, code files)
- Message pagination API is ready but UI pagination controls not yet implemented
- Presence updates have an 8-second grace period on disconnect
- Session storage means users need to log in again in new tabs
- No private channels feature (all channels are public)
- No message search functionality

## Project Structure

```
TeamChat/
├── backend/
│   ├── middleware/
│   │   └── auth.js          # JWT authentication middleware
│   ├── models/
│   │   ├── User.js          # User model
│   │   ├── Group.js         # Channel/Group model
│   │   ├── Message.js       # Message model
│   │   └── ...              # Other models
│   ├── routes/
│   │   ├── auth.js          # Authentication routes
│   │   ├── groups.js        # Channel routes
│   │   ├── messages.js      # Message routes
│   │   └── ...              # Other routes
│   └── server.js            # Express server + Socket.io setup
├── frontend/
│   ├── app/
│   │   ├── groups/          # Channel pages
│   │   ├── dashboard/       # Dashboard page
│   │   └── ...              # Other pages
│   ├── components/          # React components
│   ├── contexts/            # React contexts (Auth)
│   └── lib/                 # Utilities (API, Socket)
├── README.md
├── netlify.toml            # Netlify deployment config
├── start-backend.bat       # Windows helper script
└── start-frontend.bat      # Windows helper script
```

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Channels
- `POST /api/groups/create` - Create new channel
- `POST /api/groups/join` - Join channel with code
- `GET /api/groups/all` - Get all user's channels
- `GET /api/groups/:id` - Get single channel details
- `GET /api/groups/:id/members` - Get channel members with presence
- `POST /api/groups/:id/leave` - Leave channel
- `PUT /api/groups/:groupId/theme` - Update channel theme

### Messages
- `GET /api/messages/group/:groupId` - Get channel messages
- `PATCH /api/messages/:id` - Edit message (sender only)
- `DELETE /api/messages/:id` - Delete message (sender only)

### Block/Report
- `POST /api/block/block` - Block a user
- `POST /api/block/unblock` - Unblock a user
- `GET /api/block/blocked` - Get blocked users list
- `POST /api/block/report` - Report a user

## Socket.io Events

### Client to Server
- `join-group` - Join a channel room
- `send-message` - Send a message
- `typing-start` - User started typing
- `typing-stop` - User stopped typing
- `presence:ping` - Heartbeat for presence

### Server to Client
- `joined-group` - Confirmation of joining channel
- `new-message` - New message received
- `message-sent` - Confirmation of sent message
- `message:edited` - Message was edited
- `message:deleted` - Message was deleted
- `presence:update` - User presence changed
- `member-count-updated` - Channel member count updated
- `theme-updated` - Channel theme changed
- `typing` - User is typing
- `stop-typing` - User stopped typing

## Deployment

### Backend (Render)
- **URL:** https://teamchat-1-llwr.onrender.com
- Environment variables: `MONGO_URI`, `JWT_SECRET`, `FRONTEND_URL`, `PORT`
- Start command: `npm start`

### Frontend (Netlify)
- **URL:** https://teamchatroom.netlify.app/
- Environment variable: `NEXT_PUBLIC_API_URL` = `https://teamchat-1-llwr.onrender.com`
- Build command: `npm run build`
- Publish directory: `frontend/.next`

## License

This project is open source and available under the [MIT License](LICENSE).

## Author

**Anushka Dussa**
- GitHub: [@dussaanushka1605](https://github.com/dussaanushka1605)

---

**Made with ❤️ for real-time team collaboration**
