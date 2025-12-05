const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  anonymousName: {
    type: String,
    required: false // Optional for backward compatibility
  },
  joinedAt: {
    type: Date,
    default: Date.now
  }
});

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [memberSchema],
  removedUsers: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    removedAt: {
      type: Date,
      default: Date.now
    },
    removedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  }],
  description: {
    type: String,
    default: ''
  },
  theme: {
    type: String,
    enum: ['default', 'blue', 'green', 'purple', 'orange', 'red', 'pink', 'grey'],
    default: 'default'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Group', groupSchema);

