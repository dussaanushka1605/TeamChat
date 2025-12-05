const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Group = require('../models/Group');

// GET /api/users/:id/status
router.get('/users/:id/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('onlineSessions lastActive name');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      userId: user._id.toString(),
      isOnline: (user.onlineSessions || 0) > 0,
      lastActive: user.lastActive,
      name: user.name
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to fetch status' });
  }
});

// GET /api/groups/:groupId/members-status
router.get('/groups/:groupId/members-status', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId).populate('members.userId', 'name onlineSessions lastActive');
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const members = (group.members || []).map((m) => {
      const u = m.userId;
      const userIdStr = u?._id ? u._id.toString() : m.userId?.toString?.();
      const isOnline = u ? (u.onlineSessions || 0) > 0 : false;
      return {
        userId: userIdStr,
        name: u?.name || m.anonymousName || 'Unknown',
        anonymousName: m.anonymousName,
        isOnline,
        lastActive: u?.lastActive || null,
      };
    });

    res.json({ members });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to fetch member status' });
  }
});

module.exports = router;

