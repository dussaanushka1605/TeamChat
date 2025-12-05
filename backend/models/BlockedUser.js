const mongoose = require('mongoose');

// Helper function to generate anonymous user ID
const getAnonymousUserId = (userId) => {
  const userIdStr = userId.toString();
  return `User_${userIdStr.substring(userIdStr.length - 8)}`;
};

const blockedUserSchema = new mongoose.Schema({
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
  reason: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Ensure one block record per user pair
blockedUserSchema.index({ blockedBy: 1, blockedUser: 1 }, { unique: true });

// Pre-save hook to set anonymous IDs
blockedUserSchema.pre('save', async function(next) {
  try {
    if (!this.blockedByAnonymous) {
      this.blockedByAnonymous = getAnonymousUserId(this.blockedBy);
    }
    if (!this.blockedUserAnonymous) {
      this.blockedUserAnonymous = getAnonymousUserId(this.blockedUser);
    }
    next();
  } catch (error) {
    // Fallback to generating anonymous IDs if User lookup fails
    if (!this.blockedByAnonymous) {
      this.blockedByAnonymous = getAnonymousUserId(this.blockedBy);
    }
    if (!this.blockedUserAnonymous) {
      this.blockedUserAnonymous = getAnonymousUserId(this.blockedUser);
    }
    next();
  }
});

module.exports = mongoose.model('BlockedUser', blockedUserSchema);

