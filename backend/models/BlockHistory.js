const mongoose = require('mongoose');

// Helper function to generate anonymous user ID
const getAnonymousUserId = (userId) => {
  const userIdStr = userId.toString();
  return `User_${userIdStr.substring(userIdStr.length - 8)}`;
};

const blockHistorySchema = new mongoose.Schema({
  blockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  blockedByAnonymous: {
    type: String,
    required: true
  },
  blockedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  blockedUserAnonymous: {
    type: String,
    required: true
  },
  action: {
    type: String,
    enum: ['blocked', 'unblocked'],
    required: true
  },
  reason: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for faster queries
blockHistorySchema.index({ blockedBy: 1, createdAt: -1 });
blockHistorySchema.index({ blockedUser: 1, createdAt: -1 });
blockHistorySchema.index({ action: 1, createdAt: -1 });

// Pre-save hook to set anonymous IDs
blockHistorySchema.pre('save', async function(next) {
  try {
    if (!this.blockedByAnonymous) {
      this.blockedByAnonymous = getAnonymousUserId(this.blockedBy);
    }
    if (!this.blockedUserAnonymous) {
      this.blockedUserAnonymous = getAnonymousUserId(this.blockedUser);
    }
    next();
  } catch (error) {
    // Fallback
    if (!this.blockedByAnonymous) {
      this.blockedByAnonymous = getAnonymousUserId(this.blockedBy);
    }
    if (!this.blockedUserAnonymous) {
      this.blockedUserAnonymous = getAnonymousUserId(this.blockedUser);
    }
    next();
  }
});

module.exports = mongoose.model('BlockHistory', blockHistorySchema);

