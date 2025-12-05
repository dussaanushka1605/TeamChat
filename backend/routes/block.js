const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const BlockedUser = require('../models/BlockedUser');
const BlockHistory = require('../models/BlockHistory');
const Report = require('../models/Report');

// Block a user
router.post('/block', auth, async (req, res) => {
  try {
    const { userId, reason } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    // Check if already blocked
    const existingBlock = await BlockedUser.findOne({
      blockedBy: req.user._id,
      blockedUser: userId
    });

    if (existingBlock) {
      return res.status(400).json({ message: 'User is already blocked' });
    }

    // Cannot block yourself
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot block yourself' });
    }

    // Get anonymous IDs
    const getAnonymousUserId = (userId) => {
      const userIdStr = userId.toString();
      return `User_${userIdStr.substring(userIdStr.length - 8)}`;
    };

    const blockedByAnonymous = getAnonymousUserId(req.user._id);
    const blockedUserAnonymous = getAnonymousUserId(userId);

    const blockedUser = new BlockedUser({
      blockedBy: req.user._id,
      blockedByAnonymous: blockedByAnonymous,
      blockedUser: userId,
      blockedUserAnonymous: blockedUserAnonymous,
      reason: reason || ''
    });

    await blockedUser.save();
    console.log(`🚫 ${blockedByAnonymous} blocked ${blockedUserAnonymous}`);

    // Save to block history (permanent record)
    const blockHistory = new BlockHistory({
      blockedBy: req.user._id,
      blockedByAnonymous: blockedByAnonymous,
      blockedUser: userId,
      blockedUserAnonymous: blockedUserAnonymous,
      action: 'blocked',
      reason: reason || ''
    });
    await blockHistory.save();
    console.log(`📝 Block history saved: ${blockedByAnonymous} blocked ${blockedUserAnonymous} at ${new Date().toISOString()}`);

    // Verify the block was saved
    const savedBlock = await BlockedUser.findById(blockedUser._id);
    if (!savedBlock) {
      return res.status(500).json({ message: 'Failed to save block to database' });
    }

    // Emit real-time block event via Socket.io
    const io = req.app.get('io');
    if (io) {
      // Notify the blocked user (they are now blocked)
      io.to(userId).emit('user-blocked', {
        blockedBy: req.user._id.toString(),
        blockedUser: userId,
        blocked: true
      });
      // Notify the blocker (they have blocked someone)
      io.to(req.user._id.toString()).emit('user-blocked', {
        blockedBy: req.user._id.toString(),
        blockedUser: userId,
        blocked: true
      });
      // Notify all users in any groups they share to refresh their message lists
      io.emit('user-blocked-update', {
        blockedBy: req.user._id.toString(),
        blockedUser: userId
      });
    }

    res.json({ 
      message: 'User blocked successfully', 
      blockedUser: {
        _id: savedBlock._id,
        blockedBy: savedBlock.blockedBy,
        blockedByAnonymous: savedBlock.blockedByAnonymous,
        blockedUser: savedBlock.blockedUser,
        blockedUserAnonymous: savedBlock.blockedUserAnonymous,
        reason: savedBlock.reason,
        createdAt: savedBlock.createdAt
      }
    });
  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(500).json({ message: error.message });
  }
});

// Unblock a user
router.post('/unblock', auth, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    // Get anonymous IDs before deleting
    const getAnonymousUserId = (userId) => {
      const userIdStr = userId.toString();
      return `User_${userIdStr.substring(userIdStr.length - 8)}`;
    };

    const unblockedByAnonymous = getAnonymousUserId(req.user._id);
    const unblockedUserAnonymous = getAnonymousUserId(userId);

    const blockedUser = await BlockedUser.findOneAndDelete({
      blockedBy: req.user._id,
      blockedUser: userId
    });

    if (!blockedUser) {
      return res.status(404).json({ message: 'User is not blocked' });
    }

    // Save to block history (permanent record)
    const blockHistory = new BlockHistory({
      blockedBy: req.user._id,
      blockedByAnonymous: unblockedByAnonymous,
      blockedUser: userId,
      blockedUserAnonymous: unblockedUserAnonymous,
      action: 'unblocked',
      reason: ''
    });
    await blockHistory.save();
    console.log(`📝 Unblock history saved: ${unblockedByAnonymous} unblocked ${unblockedUserAnonymous} at ${new Date().toISOString()}`);

    // Verify the unblock was saved (check that block no longer exists)
    const verifyBlock = await BlockedUser.findOne({
      blockedBy: req.user._id,
      blockedUser: userId
    });

    if (verifyBlock) {
      return res.status(500).json({ message: 'Failed to remove block from database' });
    }

    // Emit real-time unblock event via Socket.io
    const io = req.app.get('io');
    if (io) {
      // Notify the unblocked user (they are now unblocked)
      io.to(userId).emit('user-unblocked', {
        unblockedBy: req.user._id.toString(),
        unblockedUser: userId,
        blocked: false
      });
      // Notify the unblocker (they have unblocked someone)
      io.to(req.user._id.toString()).emit('user-unblocked', {
        unblockedUser: userId,
        blocked: false
      });
      // Notify all users in any groups they share to refresh their message lists
      io.emit('user-unblocked-update', {
        unblockedBy: req.user._id.toString(),
        unblockedUser: userId
      });
    }

    res.json({ message: 'User unblocked successfully' });
  } catch (error) {
    console.error('Error unblocking user:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get blocked users list
router.get('/blocked', auth, async (req, res) => {
  try {
    const blockedUsers = await BlockedUser.find({ blockedBy: req.user._id })
      .sort({ createdAt: -1 });

    // Use stored anonymous IDs from database
    const formatted = blockedUsers.map(block => ({
      _id: block._id,
      blockedUserId: block.blockedUser.toString(),
      anonymousUserId: block.blockedUserAnonymous || `User_${block.blockedUser.toString().substring(block.blockedUser.toString().length - 8)}`,
      reason: block.reason,
      blockedAt: block.createdAt
    }));

    res.json({ blockedUsers: formatted });
  } catch (error) {
    console.error('Error fetching blocked users:', error);
    res.status(500).json({ message: error.message });
  }
});

// Check if user is blocked
router.get('/check/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if current user blocked the target
    const blockedByMe = await BlockedUser.findOne({
      blockedBy: req.user._id,
      blockedUser: userId
    });

    // Check if target user blocked current user
    const blockedByThem = await BlockedUser.findOne({
      blockedBy: userId,
      blockedUser: req.user._id
    });

    res.json({
      isBlocked: !!(blockedByMe || blockedByThem),
      blockedByMe: !!blockedByMe,
      blockedByThem: !!blockedByThem
    });
  } catch (error) {
    console.error('Error checking block status:', error);
    res.status(500).json({ message: error.message });
  }
});

// Report a user
router.post('/report', auth, async (req, res) => {
  try {
    const { userId, reason, description } = req.body;
    
    if (!userId || !reason) {
      return res.status(400).json({ message: 'userId and reason are required' });
    }

    // Cannot report yourself
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot report yourself' });
    }

    const report = new Report({
      reportedBy: req.user._id,
      reportedUser: userId,
      reason,
      description: description || '',
      status: 'pending'
    });

    await report.save();

    res.json({ message: 'User reported successfully', report });
  } catch (error) {
    console.error('Error reporting user:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get reports
router.get('/reports', auth, async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('reportedBy', 'name email')
      .populate('reportedUser', 'name email')
      .sort({ createdAt: -1 })
      .limit(100);

    // Hide real user info, show anonymous IDs
    const formatted = reports.map(report => ({
      _id: report._id,
      reportedByAnonymous: `User_${report.reportedBy._id.toString().substring(report.reportedBy._id.toString().length - 8)}`,
      reportedUserAnonymous: `User_${report.reportedUser._id.toString().substring(report.reportedUser._id.toString().length - 8)}`,
      reason: report.reason,
      description: report.description,
      status: report.status,
      adminNotes: report.adminNotes,
      createdAt: report.createdAt
    }));

    res.json({ reports: formatted });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update report status
router.patch('/reports/:reportId', auth, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, adminNotes } = req.body;

    const report = await Report.findByIdAndUpdate(
      reportId,
      { status, adminNotes },
      { new: true }
    );

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    res.json({ message: 'Report updated successfully', report });
  } catch (error) {
    console.error('Error updating report:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

