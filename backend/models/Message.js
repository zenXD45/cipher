import mongoose from 'mongoose';

const sealedCopySchema = new mongoose.Schema(
  {
    ct: { type: String, required: true },
    iv: { type: String, required: true },
    alg: { type: String, required: true, default: 'AES-GCM' }
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  payload: {
    forSender: { type: sealedCopySchema, required: true },
    forRecipient: { type: sealedCopySchema, required: true }
  },
  keyId: { type: String, match: /^[0-9a-f]{64}$/ },
  readAt: { type: Date, default: null, index: true },
  createdAt: { type: Date, default: Date.now, index: true }
});

messageSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });
messageSchema.index({ recipientId: 1, readAt: 1 });

messageSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(doc, ret) {
    ret.id = doc.id;
    delete ret._id;
    return ret;
  }
});

export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);