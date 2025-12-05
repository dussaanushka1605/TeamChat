const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Message = require('../models/Message');
const Group = require('../models/Group');
const BlockedUser = require('../models/BlockedUser');

// Ensure text index exists (runs on startup)
Message.collection.createIndex({ content: "text" }).catch((err) => {
  console.warn('Message text index creation failed (non-fatal):', err.message);
});

// Get messages for a group
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if user was removed from group
    const wasRemoved = group.removedUsers && group.removedUsers.some(
      r => r.userId.toString() === req.user._id.toString()
    );

    if (wasRemoved) {
      return res.status(403).json({ message: 'You have been removed from this group' });
    }

    // Check if user is a member
    // Handle both populated and non-populated userId
    const isMember = group.members.some(m => {
      if (!m || !m.userId) return false;
      // If populated, userId is an object with _id, otherwise it's an ObjectId
      const memberUserId = m.userId._id ? m.userId._id.toString() : m.userId.toString();
      return memberUserId === req.user._id.toString();
    });

    if (!isMember) {
      return res.status(403).json({ message: 'Not a member of this group' });
    }

        const messages = await Message.find({ 
          groupId: req.params.groupId,
          messageType: 'group',
          // Only show messages that are not marked as deleted
          $or: [
            { 'autoDelete.isDeleted': { $ne: true } },
            { 'autoDelete.isDeleted': { $exists: false } }
          ]
        })
        .sort({ createdAt: 1 })
        .limit(100)
        .lean();

    // Get all blocked relationships for current user
    const blockedByMe = await BlockedUser.find({ blockedBy: req.user._id }).lean();
    const blockedByMeSet = new Set(blockedByMe.map(b => b.blockedUser.toString()));
    
    const blockedMe = await BlockedUser.find({ blockedUser: req.user._id }).lean();
    const blockedMeSet = new Set(blockedMe.map(b => b.blockedBy.toString()));

    // Filter messages based on mutual blocking
    const filteredMessages = messages.filter(msg => {
      if (!msg.userId) return true; // Include messages without userId
      
      const messageUserId = msg.userId.toString();
      
      // Exclude if current user blocked the sender
      if (blockedByMeSet.has(messageUserId)) {
        return false;
      }
      
      // Exclude if sender blocked the current user
      if (blockedMeSet.has(messageUserId)) {
        return false;
      }
      
      return true;
    });

    // Include userId in response for frontend filtering
    const messagesWithUserId = filteredMessages.map(msg => ({
      ...msg,
      userId: msg.userId ? msg.userId.toString() : undefined
    }));

    res.json({ messages: messagesWithUserId });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Edit a message (only sender)
router.patch('/:id', auth, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ message: 'Text is required' });
    }

    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only edit your own messages' });
    }

    message.content = text.trim();
    message.edited = true;
    await message.save();

    const payload = {
      _id: message._id.toString(),
      text: message.content,
      content: message.content,
      senderId: message.senderId.toString(),
      senderName: message.senderName,
      groupId: message.groupId.toString(),
      timestamp: message.createdAt,
      edited: true
    };

    const io = req.app.get('io');
    if (io) {
      io.to(message.groupId.toString()).emit('message:edited', payload);
    }

    res.json({ message: payload });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete a message (only sender)
router.delete('/:id', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (message.senderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }

    const groupId = message.groupId.toString();
    const messageId = message._id.toString();
    await Message.deleteOne({ _id: messageId });

    const io = req.app.get('io');
    if (io) {
      io.to(groupId).emit('message:deleted', { id: messageId, groupId });
    }

    res.json({ message: 'Message deleted successfully', id: messageId });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

