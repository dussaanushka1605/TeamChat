const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Announcement = require('../models/Announcement');
const Group = require('../models/Group');

// Create announcement (All authenticated users)
router.post('/create', auth, async (req, res) => {
  try {
    const { groupId } = req.body;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if announcement already exists for this group
    const existingAnnouncement = await Announcement.findOne({ groupId });
    if (existingAnnouncement) {
      return res.status(400).json({ message: 'Announcement already exists for this group' });
    }

    const announcement = new Announcement({
      groupId: group._id,
      groupName: group.name,
      groupCode: group.code,
      createdBy: req.user._id
    });

    await announcement.save();

    res.status(201).json({
      announcement: {
        id: announcement._id,
        groupId: announcement.groupId,
        groupName: announcement.groupName,
        groupCode: announcement.groupCode,
        createdAt: announcement.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all announcements (show every channel for every user, no filtering)
router.get('/all', auth, async (req, res) => {
  try {
    // We rely on the canonical source of truth: all channels (groups) in the database.
    const groups = await Group.find({})
      .sort({ createdAt: -1 })
      .lean();

    const announcements = groups.map(group => ({
      _id: group._id.toString(), // keep compatibility with existing frontend keys
      groupId: group._id.toString(),
      groupName: group.name,
      groupCode: group.code,
      createdBy: group.createdBy ? group.createdBy.toString() : null,
      createdAt: group.createdAt,
      membersCount: Array.isArray(group.members) ? group.members.length : 0,
    }));

    res.json({ announcements });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ message: error.message });
  }
});

// Delete announcement (creator only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    if (announcement.createdBy?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the creator can delete this announcement.' });
    }

    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

