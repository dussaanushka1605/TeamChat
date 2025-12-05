const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Group = require('../models/Group');
const User = require('../models/User');
const ThemeHistory = require('../models/ThemeHistory');

// Get socket.io instance (will be set by server.js)
let io = null;
let onlineUsersMap = null;
const setIO = (socketIO, onlineUsers) => {
  io = socketIO;
  onlineUsersMap = onlineUsers;
};

const getPresenceForUser = async (userId) => {
  const isOnline = onlineUsersMap ? onlineUsersMap.has(userId.toString()) : false;
  const userDoc = await User.findById(userId).select('lastActive');
  return {
    isOnline,
    lastActive: userDoc?.lastActive || null
  };
};

// Helper function to check if a user is a member of a group
const isUserMemberOfGroup = (group, userId) => {
  if (!group || !group.members || !Array.isArray(group.members)) return false;
  return group.members.some(member => {
    if (!member || !member.userId) return false;
    const memberUserId = member.userId._id ? member.userId._id.toString() : member.userId.toString();
    return memberUserId === userId.toString();
  });
};

// Helper function to check if a specific member object matches a userId
const isUserMember = (member, userId) => {
  if (!member || !member.userId) return false;
  const memberUserId = member.userId._id ? member.userId._id.toString() : member.userId.toString();
  return memberUserId === userId.toString();
};

// Generate random group code
const generateGroupCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Generate anonymous name
const generateAnonymousName = () => {
  const adjectives = [
    "Happy", "Cheerful", "Bright", "Swift", "Gentle", "Brave", "Cool", "Wise",
    "Lucky", "Noble", "Bold", "Calm", "Kind", "Sunny", "Clever", "Witty",
    "Mighty", "Serene", "Jolly", "Proud", "Fierce", "Silent", "Golden", "Silver"
  ];
  
  const nouns = [
    "Panda", "Dragon", "Phoenix", "Tiger", "Eagle", "Wolf", "Fox", "Bear",
    "Lion", "Hawk", "Owl", "Dolphin", "Whale", "Butterfly", "Falcon", "Leopard",
    "Shark", "Raven", "Swan", "Deer", "Otter", "Lynx", "Koala", "Penguin"
  ];
  
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 100);
  
  return `${adjective} ${noun} ${number}`;
};

// Create group (All authenticated users) - creator is NOT auto-added
router.post('/create', auth, async (req, res) => {
  try {
    const { name, description } = req.body;

    let code = generateGroupCode();
    // Ensure unique code
    while (await Group.findOne({ code })) {
      code = generateGroupCode();
    }

    // Create group without auto-joining creator
    const group = new Group({
      name,
      code,
      description: description || '',
      createdBy: req.user._id,
      members: [],
      theme: 'default'
    });

    await group.save();
    console.log(`✅ Group created by user ${req.user._id} - creator NOT auto-added`);

    // Automatically create announcement for the new group
    const Announcement = require('../models/Announcement');
    try {
      const announcement = new Announcement({
        groupId: group._id,
        groupName: group.name,
        groupCode: group.code,
        createdBy: req.user._id
      });
      await announcement.save();
      console.log(`✅ Announcement created for group ${group._id}`);
      
      // Broadcast announcement to ALL users via Socket.IO (use channel data as source of truth)
      if (io) {
        const announcementData = {
          _id: group._id.toString(), // align with channel id for frontend consistency
          groupId: group._id.toString(),
          groupName: group.name,
          groupCode: group.code,
          createdBy: req.user._id.toString(),
          createdAt: group.createdAt,
          membersCount: 0
        };
        io.emit('newAnnouncement', announcementData);
        console.log(`📢 Announcement broadcasted to all users`);
      }
    } catch (announcementError) {
      console.error('❌ Error creating announcement:', announcementError);
      // Don't fail group creation if announcement fails
    }

    res.status(201).json({
      group: {
        id: group._id,
        name: group.name,
        code: group.code,
        description: group.description,
        createdAt: group.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Join group with code or groupId
router.post('/join', auth, async (req, res) => {
  try {
    const { code, groupId } = req.body || {};

    let group;
    if (groupId) {
      group = await Group.findById(groupId);
    } else if (typeof code === 'string' && code.trim().length > 0) {
      const normalizedCode = code.trim().toUpperCase();
      group = await Group.findOne({ code: normalizedCode });
    } else {
      return res.status(400).json({ message: 'Either code or groupId is required' });
    }

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if user was removed from this group
    const wasRemoved = group.removedUsers && group.removedUsers.some(
      r => r.userId.toString() === req.user._id.toString()
    );

    if (wasRemoved) {
      return res.status(403).json({ message: 'You have been removed from this group.' });
    }

    // Check if user is already a member
    const existingMember = group.members.find(
      m => isUserMember(m, req.user._id)
    );

    if (existingMember) {
      // Reload group to get latest member count
      const updatedGroup = await Group.findById(group._id);
      return res.json({
        group: {
          id: updatedGroup._id,
          name: updatedGroup.name,
          code: updatedGroup.code,
          description: updatedGroup.description,
          anonymousName: existingMember.anonymousName,
          membersCount: updatedGroup.members.length
        }
      });
    }

    // Add user as member with real name
    const baseName = (req.user?.name || '').trim() || `User_${req.user._id.toString().slice(-4)}`;
    // Ensure unique name in group
    let finalAnonymousName = baseName;
    let attempts = 0;
    while (group.members.some(m => m.anonymousName === finalAnonymousName) && attempts < 10) {
      finalAnonymousName = `${baseName} (${req.user._id.toString().slice(-4)})`;
      attempts++;
    }
    
    group.members.push({
      userId: req.user._id,
      anonymousName: finalAnonymousName,
      joinedAt: new Date()
    });

    await group.save();
    console.log(`✅ User ${req.user._id} joined group ${group._id} with anonymous name: ${finalAnonymousName}`);
    
    // Reload group to ensure we have the latest data
    const updatedGroup = await Group.findById(group._id).populate('members.userId', 'name');

    // Emit real-time member count update to all users in the group
    if (io) {
      io.to(group._id.toString()).emit('member-count-updated', {
        memberCount: updatedGroup.members.length,
        members: updatedGroup.members.map(m => ({
          userId: m.userId._id ? m.userId._id.toString() : m.userId.toString(),
          name: m.userId.name || m.anonymousName,
          anonymousName: m.anonymousName
        }))
      });
    }

    // Broadcast channel update to all users (for announcements/My Channels refresh)
    if (io) {
      io.emit('channelUpdated', {
        id: updatedGroup._id.toString(),
        name: updatedGroup.name,
        code: updatedGroup.code,
        description: updatedGroup.description,
        membersCount: updatedGroup.members.length,
        createdBy: updatedGroup.createdBy?.toString?.() || updatedGroup.createdBy
      });
    }

    res.json({
      success: true,
      group: {
        id: updatedGroup._id,
        name: updatedGroup.name,
        code: updatedGroup.code,
        description: updatedGroup.description,
        anonymousName: finalAnonymousName,
        membersCount: updatedGroup.members.length
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all groups (Only show groups where user is a member)
router.get('/all', auth, async (req, res) => {
  try {
    // Users only see groups they are members of
    // This ensures that if they leave a group, it disappears from "My Groups"
    // Find all groups and filter by membership (more reliable than query)
    const allGroups = await Group.find({})
      .populate('createdBy', 'name email')
      .populate('members.userId', 'name lastActive onlineSessions')
      .sort({ createdAt: -1 });
    
    // Filter groups where user is actually a member
    const groups = allGroups.filter(group => isUserMemberOfGroup(group, req.user._id));

    const formattedGroups = groups.map(group => {
      const groupObj = group.toObject();
      if (typeof groupObj.code !== 'string') {
        groupObj.code = '';
      }
      
      // Only include actual members who joined (not creator unless they joined)
      const actualMembers = (groupObj.members || []).filter(member => {
        // Only show members who explicitly joined (not the creator unless they joined as a member)
        return member && member.userId && member.anonymousName;
      });
      
      // Find the current user's member info
      const userMember = actualMembers.find(
        m => isUserMember(m, req.user._id)
      );

      groupObj.members = actualMembers.map(member => ({
        anonymousName: member.anonymousName,
        joinedAt: member.joinedAt,
        isOnline: onlineUsersMap ? onlineUsersMap.has(member.userId.toString()) : false,
        lastActive: member.userId.lastActive
      }));
      groupObj.userAnonymousName = userMember ? userMember.anonymousName : null;

      return groupObj;
    });

    res.json({ groups: formattedGroups || [] });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch groups' });
  }
});

// Get single group
router.get('/:id', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.userId', 'name lastActive onlineSessions');
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if user is a member
    // Use helper function to handle both populated and non-populated userId
    const isMember = group.members.some(
      m => isUserMember(m, req.user._id)
    );

    if (!isMember) {
      return res.status(403).json({ message: 'Not a member of this group' });
    }

    const groupObj = group.toObject();

    // Only include actual members who joined (not creator unless they joined)
    const actualMembers = groupObj.members.filter(member => {
      return member.userId && member.anonymousName;
    });

    // Find the current user's member info
    const userMember = actualMembers.find(
      m => isUserMember(m, req.user._id)
    );

    groupObj.userAnonymousName = userMember ? userMember.anonymousName : null;
    groupObj.members = actualMembers.map(member => ({
      userId: member.userId.toString(),
      anonymousName: member.anonymousName,
      name: member.userId.name || member.anonymousName,
      joinedAt: member.joinedAt,
      isOnline: onlineUsersMap ? onlineUsersMap.has(member.userId.toString()) : false,
      lastActive: member.userId.lastActive
    }));

    res.json({ group: groupObj });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Remove user from group (group creator only)
router.post('/:groupId/remove-user', auth, async (req, res) => {
  try {
    const { userId } = req.body;
    const groupId = req.params.groupId;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (group.createdBy?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the group creator can remove members.' });
    }

    // Find the member to remove
    const memberIndex = group.members.findIndex(
      m => m.userId.toString() === userId.toString()
    );

    if (memberIndex === -1) {
      return res.status(404).json({ message: 'User is not a member of this group' });
    }

    // Check if already removed
    const alreadyRemoved = group.removedUsers && group.removedUsers.some(
      r => r.userId.toString() === userId.toString()
    );

    if (alreadyRemoved) {
      return res.status(400).json({ message: 'User is already removed from this group' });
    }

    // Remove from members
    const removedMember = group.members[memberIndex];
    group.members.splice(memberIndex, 1);

    // Add to removedUsers
    if (!group.removedUsers) {
      group.removedUsers = [];
    }
    group.removedUsers.push({
      userId: userId,
      removedAt: new Date(),
      removedBy: req.user._id
    });

    await group.save();

    // Emit real-time update to notify group members
    if (io) {
      io.to(groupId).emit('user-removed-from-group', {
        userId: userId.toString(),
        groupId: groupId,
        memberCount: group.members.length
      });

      // Notify the removed user
      io.to(userId.toString()).emit('removed-from-group', {
        groupId: groupId,
        groupName: group.name
      });

      // Update member count for all in group
      io.to(groupId).emit('member-count-updated', {
        memberCount: group.members.length,
        members: group.members.map(m => ({
          anonymousName: m.anonymousName,
          userId: m.userId.toString()
        }))
      });
    }

    res.json({ 
      message: 'User removed from group successfully',
      memberCount: group.members.length
    });
  } catch (error) {
    console.error('Error removing user from group:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update group theme (All users can change)
router.put('/:groupId/theme', auth, async (req, res) => {
  try {
    const { theme } = req.body;
    const groupId = req.params.groupId;

    if (!theme) {
      return res.status(400).json({ message: 'Theme is required' });
    }

    const validThemes = ['default', 'blue', 'green', 'purple', 'orange', 'red', 'pink', 'grey'];
    if (!validThemes.includes(theme)) {
      return res.status(400).json({ message: 'Invalid theme' });
    }

        const group = await Group.findById(groupId);
        if (!group) {
          return res.status(404).json({ message: 'Group not found' });
        }

        const oldTheme = group.theme;
        group.theme = theme;
        await group.save();

        // Get anonymous ID for history
        const getAnonymousUserId = (userId) => {
          const userIdStr = userId.toString();
          return `User_${userIdStr.substring(userIdStr.length - 8)}`;
        };

        const changedByAnonymous = getAnonymousUserId(req.user._id);

        // Save theme change to history (permanent record)
        const themeHistory = new ThemeHistory({
          groupId: group._id,
          groupName: group.name,
          groupCode: group.code,
          changedBy: req.user._id,
          changedByAnonymous: changedByAnonymous,
          oldTheme: oldTheme,
          newTheme: theme
        });
        await themeHistory.save();
        console.log(`🎨 Theme history saved: ${changedByAnonymous} changed theme from "${oldTheme}" to "${theme}" in group "${group.name}" at ${new Date().toISOString()}`);

        // Emit theme update to all users in the group
        if (io) {
          io.to(groupId).emit('theme-updated', {
            groupId: groupId,
            theme: theme
          });
        }

        res.json({ 
          message: 'Theme updated successfully',
          theme: group.theme
        });
  } catch (error) {
    console.error('Error updating theme:', error);
    res.status(500).json({ message: error.message });
  }
});

// Join group by ID (for announcements)
router.post('/:id/join', auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const group = await Group.findById(groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if user was removed from this group
    const wasRemoved = group.removedUsers && group.removedUsers.some(
      r => r.userId.toString() === req.user._id.toString()
    );

    if (wasRemoved) {
      return res.status(403).json({ message: 'You have been removed from this group.' });
    }

    // Check if user is already a member
    const existingMember = group.members.find(
      m => isUserMember(m, req.user._id)
    );

    if (existingMember) {
      return res.json({
        success: true,
        message: 'Already a member of this group',
        group: {
          id: group._id,
          name: group.name,
          code: group.code
        }
      });
    }

    // Add user as member with anonymous name
    const anonymousName = generateAnonymousName();
    // Ensure unique anonymous name in group
    let finalAnonymousName = anonymousName;
    let attempts = 0;
    while (group.members.some(m => m.anonymousName === finalAnonymousName) && attempts < 10) {
      finalAnonymousName = generateAnonymousName();
      attempts++;
    }
    
    group.members.push({
      userId: req.user._id,
      anonymousName: finalAnonymousName,
      joinedAt: new Date()
    });

    await group.save();
    console.log(`✅ User ${req.user._id} joined group ${group._id} with anonymous name: ${finalAnonymousName}`);
    
    // Delete announcement after user joins
    const Announcement = require('../models/Announcement');
    try {
      await Announcement.deleteOne({ groupId: group._id });
      console.log(`✅ Announcement deleted for group ${group._id}`);
      
      // Broadcast announcement removal to all users
      if (io) {
        io.emit('announcementRemoved', { groupId: group._id.toString() });
      }
    } catch (announcementError) {
      console.error('❌ Error deleting announcement:', announcementError);
      // Don't fail join if announcement deletion fails
    }
    
    // Emit real-time member count update
    if (io) {
      io.to(groupId).emit('member-count-updated', {
        memberCount: group.members.length,
        members: group.members.map(m => ({
          anonymousName: m.anonymousName
        }))
      });
    }

    res.json({
      success: true,
      message: 'Joined group successfully',
      group: {
        id: group._id,
        name: group.name,
        code: group.code,
        anonymousName: finalAnonymousName
      }
    });
  } catch (error) {
    console.error('Error joining group:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get members with presence info
router.get('/:id/members', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.userId', 'name lastActive onlineSessions');

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const isMember = group.members.some(m => isUserMember(m, req.user._id));
    if (!isMember) {
      return res.status(403).json({ message: 'Not a member of this group' });
    }

    const members = (group.members || []).map(member => {
      const uid = member.userId?._id ? member.userId._id.toString() : member.userId.toString();
      return {
        userId: uid,
        name: member.userId?.name || member.anonymousName || 'Unknown',
        anonymousName: member.anonymousName,
        isOnline: onlineUsersMap ? onlineUsersMap.has(uid) : false,
        lastActive: member.userId?.lastActive || null,
        joinedAt: member.joinedAt
      };
    });

    res.json({ members });
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch members' });
  }
});

// Leave group
router.delete('/:id/leave', auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const group = await Group.findById(groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if user is a member
    const memberIndex = group.members.findIndex(
      m => isUserMember(m, req.user._id)
    );

    if (memberIndex === -1) {
      return res.status(404).json({ message: 'You are not a member of this group' });
    }

    // Remove user from members
    group.members.splice(memberIndex, 1);
    await group.save();

    console.log(`✅ User ${req.user._id} left group ${group._id}`);

    // Emit real-time member count update
    if (io) {
      io.to(groupId).emit('member-count-updated', {
        memberCount: group.members.length,
        members: group.members.map(m => ({
          anonymousName: m.anonymousName
        }))
      });

      // Notify the user who left
      io.to(req.user._id.toString()).emit('left-group', {
        groupId: groupId,
        groupName: group.name
      });
    }

    res.json({
      success: true,
      message: 'Left group successfully'
    });
  } catch (error) {
    console.error('Error leaving group:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
module.exports.setIO = setIO;
