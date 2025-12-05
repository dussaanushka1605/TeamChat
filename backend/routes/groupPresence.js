const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Group = require('../models/Group');
const User = require('../models/User');

// GET /api/groups/:id/members-status
router.get('/groups/:id/members-status', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id).populate('members.userId', 'name onlineSessions lastActive');
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const members = (group.members || []).map((m) => {
      const u = m.userId;
      const userIdStr = u?._id ? u._id.toString() : null;
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
    console.error('Error fetching member status:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch member status' });
  }
});

module.exports = router;

