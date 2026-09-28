import mongoose from 'mongoose';

const activeKeySchema = new mongoose.Schema(
  {
    spki: { type: String, required: true },
    fingerprint: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    updatedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9_-]{3,24}$/
    },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    googleId: { type: String, unique: true, sparse: true },
    avatar: { type: String, default: '' },
    activeKey: { type: activeKeySchema, default: undefined },
    createdAt: { type: Date, default: Date.now }
  },
  { minimize: false }
);

userSchema.index({ username: 'text' });

userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(doc, ret) {
    ret.id = doc.id;
    delete ret._id;
    return ret;
  }
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);