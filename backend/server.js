const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
if (!process.env.MONGO_URI || process.env.MONGO_URI.includes('your_mongodb_atlas')) {
  console.error('❌ ERROR: MONGO_URI not set in .env file!');
  console.error('Please set MONGO_URI in backend/.env file');
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  console.error('Please check your MONGO_URI in backend/.env file');
});

// Presence tracking
const onlineUsers = new Map(); // userId -> { sessionIds: Set, name?: string }
const presenceGraceTimers = new Map(); // userId -> timeout
const OFFLINE_GRACE_MS = 8000;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
const groupsRouter = require('./routes/groups');
groupsRouter.setIO(io, onlineUsers); // Pass socket.io instance and onlineUsers to groups router
app.use('/api/groups', groupsRouter);
app.use('/api/messages', require('./routes/messages'));
const blockRouter = require('./routes/block');
app.use('/api/block', blockRouter);
app.use('/api', require('./routes/presence'));
app.use('/api', require('./routes/groupPresence'));
// Make io available to block router
app.set('io', io);
app.use('/api/announcements', require('./routes/announcements'));

// Socket.io connection handling
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) throw new Error('no token');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id || decoded._id || decoded.userId;
    socket.sessionId = socket.handshake.auth?.sessionId || uuidv4();
    next();
  } catch (err) {
    console.error('SOCKET AUTH FAILED:', err.message);
    next(new Error('unauthorized'));
  }
});

io.on('connection', async (socket) => {
  const userId = socket.userId?.toString();
  if (!userId) {
    socket.disconnect(true);
    return;
  }

  console.log(`[presence] CONNECT user=${userId}, session=${socket.sessionId}`);

  // Cancel pending offline timer if any
  if (presenceGraceTimers.has(userId)) {
    clearTimeout(presenceGraceTimers.get(userId));
    presenceGraceTimers.delete(userId);
  }

  // Track session in memory
  const existing = onlineUsers.get(userId) || { sessionIds: new Set(), name: null };
  existing.sessionIds.add(socket.sessionId);
  onlineUsers.set(userId, existing);

  // Increment session count in DB and update lastActive
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $inc: { onlineSessions: 1 }, $set: { lastActive: new Date() } },
    { new: true }
  ).catch(() => null);
  if (updatedUser) {
    existing.name = updatedUser.name;
    onlineUsers.set(userId, existing);
  }

  // Join user's private room
  socket.join(`user:${userId}`);

  // Broadcast presence update
  io.emit('presence:update', { userId, isOnline: true, lastActive: updatedUser?.lastActive || new Date() });

  // Join group room
  socket.on('join-group', async (groupId) => {
    try {
      const Group = require('./models/Group');
      const group = await Group.findById(groupId);
      
      if (!group) {
        socket.emit('error', { message: 'Group not found' });
        return;
      }

      // Check if user was removed from group
      const wasRemoved = group.removedUsers && group.removedUsers.some(
        r => r.userId.toString() === socket.userId.toString()
      );

      if (wasRemoved) {
        socket.emit('error', { message: 'You have been removed from this group' });
        return;
      }

      // Check if user is member of group
      // Check if user is member of group (handle both populated and non-populated userId)
      const member = group.members.find(m => {
        if (!m || !m.userId) return false;
        const memberUserId = m.userId._id ? m.userId._id.toString() : m.userId.toString();
        return memberUserId === socket.userId.toString();
      });
      if (!member) {
        socket.emit('error', { message: 'Not a member of this group' });
        return;
      }

      socket.join(groupId);
      socket.currentGroupId = groupId;
      
      // Get user's real name and anonymous name
      const User = require('./models/User');
      const user = await User.findById(socket.userId);
      const userName = user ? user.name : (socket.userName || 'Unknown');
      
      // Get user's anonymous name from group membership (handle both populated and non-populated userId)
      const userMember = group.members.find(m => {
        if (!m || !m.userId) return false;
        const memberUserId = m.userId._id ? m.userId._id.toString() : m.userId.toString();
        return memberUserId === socket.userId.toString();
      });
      const anonymousName = userMember?.anonymousName || 'Unknown';
      
      socket.emit('joined-group', { groupId, userName, anonymousName });
      
      // Notify others and send updated member count
      const updatedGroup = await Group.findById(groupId).populate('members.userId', 'name');
      socket.to(groupId).emit('user-joined', { 
        userName,
        memberCount: updatedGroup.members.length 
      });
      
      // Send updated member count to all in room
      io.to(groupId).emit('member-count-updated', {
        memberCount: updatedGroup.members.length,
        members: updatedGroup.members.map(m => ({
          userId: m.userId._id.toString(),
          name: m.userId.name
        }))
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Handle chat messages
  socket.on('send-message', async (data) => {
    try {
      const Message = require('./models/Message');
      const Group = require('./models/Group');
      
      const group = await Group.findById(data.groupId);
      if (!group) {
        socket.emit('error', { message: 'Group not found' });
        return;
      }

      // Check if user is member of group (handle both populated and non-populated userId)
      const member = group.members.find(m => {
        if (!m || !m.userId) return false;
        const memberUserId = m.userId._id ? m.userId._id.toString() : m.userId.toString();
        return memberUserId === socket.userId.toString();
      });
      if (!member) {
        socket.emit('error', { message: 'Not a member of this group' });
        return;
      }

      // Get user's real name
      const User = require('./models/User');
      const user = await User.findById(socket.userId);
      const senderName = user ? user.name : (socket.userName || 'Unknown');

      // Calculate expiration time if auto-delete is enabled
      let expiresAt = null;
      if (data.autoDelete && data.autoDelete.enabled && data.autoDelete.deleteAfter) {
        expiresAt = new Date(Date.now() + (data.autoDelete.deleteAfter * 1000));
      }

      const message = new Message({
        groupId: data.groupId,
        senderId: socket.userId,
        senderName: senderName,
        content: data.content,
        messageType: 'group',
        isFile: data.isFile || false,
        fileName: data.fileName || null,
        fileContent: data.fileContent || null,
        fileSize: data.fileSize || null,
        autoDelete: {
          enabled: data.autoDelete?.enabled || false,
          deleteAfter: data.autoDelete?.deleteAfter || null,
          expiresAt: expiresAt
        }
      });

      await message.save();
      console.log(`✅ Message saved: ${message._id} in group ${data.groupId} by ${senderName}`);

      const messageData = {
        _id: message._id,
        groupId: message.groupId.toString(),
        senderId: message.senderId.toString(),
        senderName: message.senderName,
        content: message.content,
        edited: message.edited || false,
        messageType: message.messageType,
        isFile: message.isFile,
        fileName: message.fileName,
        fileContent: message.fileContent,
        fileSize: message.fileSize,
        autoDelete: message.autoDelete,
        timestamp: message.createdAt,
        createdAt: message.createdAt
      };

      // Get all sockets in the group room
      const BlockedUser = require('./models/BlockedUser');
      const socketsInRoom = await io.in(data.groupId).fetchSockets();
      
      // Emit to each recipient individually, checking for mutual blocking
      for (const s of socketsInRoom) {
        if (s.id === socket.id || !s.userId) continue; // Skip sender and sockets without userId
        
        const recipientUserId = s.userId.toString();
        
        // Check mutual blocking: if sender blocked recipient OR recipient blocked sender
        const senderBlockedRecipient = await BlockedUser.findOne({
          blockedBy: socket.userId,
          blockedUser: recipientUserId
        });
        
        const recipientBlockedSender = await BlockedUser.findOne({
          blockedBy: recipientUserId,
          blockedUser: socket.userId
        });
        
        // Only send message if neither has blocked the other (mutual blocking check)
        if (!senderBlockedRecipient && !recipientBlockedSender) {
          s.emit('new-message', messageData);
        }
      }
      
      // Send confirmation to sender only (so they see their own message)
      socket.emit('message-sent', messageData);
      
      // Log message save for permanent tracking
      const fileInfo = data.isFile ? ` [FILE: ${data.fileName}, ${data.fileSize} bytes]` : '';
      const autoDeleteInfo = data.autoDelete?.enabled ? ` [AUTO-DELETE: ${data.autoDelete.deleteAfter}s]` : '';
      console.log(`💬 Message saved PERMANENTLY: ID=${message._id}, From=${senderName}, Group=${data.groupId}, Content="${data.content.substring(0, 50)}${data.content.length > 50 ? '...' : ''}"${fileInfo}${autoDeleteInfo}`);
    } catch (error) {
      console.error('❌ Error saving message:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // Handle typing indicator
  socket.on('typing', async (data) => {
    try {
      const { groupId } = data;
      if (groupId && socket.userName) {
        // Emit typing to all users in the group except sender
        socket.to(groupId).emit('typing', {
          userId: socket.userId.toString(),
          userName: socket.userName,
          groupId: groupId
        });
      }
    } catch (error) {
      console.error('Error handling typing:', error);
    }
  });

  // Handle stop typing
  socket.on('stop-typing', async (data) => {
    try {
      const { groupId } = data;
      if (groupId && socket.userName) {
        // Emit stop typing to all users in the group except sender
        socket.to(groupId).emit('stop-typing', {
          userId: socket.userId.toString(),
          userName: socket.userName,
          groupId: groupId
        });
      }
    } catch (error) {
      console.error('Error handling stop typing:', error);
    }
  });

  socket.on('presence:ping', () => {
    User.findByIdAndUpdate(userId, { $set: { lastActive: new Date() } }).catch(() => {});
  });

  socket.on('presence:ping', () => {
    User.findByIdAndUpdate(userId, { $set: { lastActive: new Date() } }).catch(() => {});
  });

  socket.on('disconnect', async () => {
    console.log(`[presence] DISCONNECT user=${userId}, session=${socket.sessionId}`);

    if (presenceGraceTimers.has(userId)) clearTimeout(presenceGraceTimers.get(userId));

    const timer = setTimeout(async () => {
      // Remove session from memory
      const info = onlineUsers.get(userId);
      if (info) {
        info.sessionIds.delete(socket.sessionId);
        if (info.sessionIds.size === 0) {
          onlineUsers.delete(userId);
        } else {
          onlineUsers.set(userId, info);
        }
      }

      const updated = await User.findByIdAndUpdate(
        userId,
        { $inc: { onlineSessions: -1 }, $set: { lastActive: new Date() } },
        { new: true }
      );
      if (!updated) return;
      if ((updated.onlineSessions || 0) <= 0) {
        await User.findByIdAndUpdate(userId, { onlineSessions: 0 });
        io.emit('presence:update', { userId, isOnline: false, lastActive: updated.lastActive });
        console.log(`[presence] OFFLINE user=${userId}`);
      } else {
        io.emit('presence:update', { userId, isOnline: true, lastActive: updated.lastActive });
      }
      presenceGraceTimers.delete(userId);
    }, OFFLINE_GRACE_MS);

    presenceGraceTimers.set(userId, timer);
  });
});

// Export onlineUsers for use in routes
module.exports.onlineUsers = onlineUsers;

// Auto-delete expired messages job (runs every minute)
// IMPORTANT: Messages are NOT deleted from database, only marked as deleted
setInterval(async () => {
  try {
    const Message = require('./models/Message');
    const now = new Date();
    
    // Find messages that have expired but not yet marked as deleted
    const expiredMessages = await Message.find({
      'autoDelete.enabled': true,
      'autoDelete.expiresAt': { $lte: now },
      'autoDelete.isDeleted': false
    });

    if (expiredMessages.length > 0) {
      const messageIds = expiredMessages.map(m => m._id.toString());
      const groupIds = [...new Set(expiredMessages.map(m => m.groupId.toString()))];

      // Mark messages as deleted (DO NOT DELETE FROM DATABASE - keep permanently)
      await Message.updateMany(
        {
          _id: { $in: expiredMessages.map(m => m._id) }
        },
        {
          $set: {
            'autoDelete.isDeleted': true,
            'autoDelete.deletedAt': now
          }
        }
      );

      // Notify all clients in affected groups
      groupIds.forEach(groupId => {
        const groupMessageIds = expiredMessages
          .filter(m => m.groupId.toString() === groupId)
          .map(m => m._id.toString());
        
        io.to(groupId).emit('messages-deleted', {
          messageIds: groupMessageIds,
          groupId: groupId
        });
      });

      console.log(`🗑️ Marked ${expiredMessages.length} expired message(s) as deleted (kept in database permanently)`);
    }
  } catch (error) {
    console.error('Error in auto-delete job:', error);
  }
}, 60000); // Run every minute

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 API available at /api`);
    console.log(`💓 Health check at /health`);
});


