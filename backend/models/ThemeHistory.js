const mongoose = require('mongoose');

const themeHistorySchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    required: true
  },
  groupName: {
    type: String,
    required: true
  },
  groupCode: {
    type: String,
    required: true
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  changedByAnonymous: {
    type: String,
    required: true
  },
  oldTheme: {
    type: String
  },
  newTheme: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Index for faster queries
themeHistorySchema.index({ groupId: 1, createdAt: -1 });
themeHistorySchema.index({ changedBy: 1, createdAt: -1 });

// Pre-save hook to set anonymous ID
themeHistorySchema.pre('save', async function(next) {
  try {
    if (!this.changedByAnonymous) {
      this.changedByAnonymous = `User_${this.changedBy.toString().substring(this.changedBy.toString().length - 8)}`;
    }
    next();
  } catch (error) {
    if (!this.changedByAnonymous) {
      this.changedByAnonymous = `User_${this.changedBy.toString().substring(this.changedBy.toString().length - 8)}`;
    }
    next();
  }
});

module.exports = mongoose.model('ThemeHistory', themeHistorySchema);

