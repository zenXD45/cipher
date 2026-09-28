import mongoose from 'mongoose';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';

const THREAD_PAGE = 30;
const THREAD_MAX = 100;

const SEALED_KEYS = new Set(['ct', 'iv', 'alg']);

function bad(message) {
  return { status: 400, message };
}

function validateSealed(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return `${path} must be a sealed envelope`;
  }
  for (const key of Object.keys(value)) {
    if (!SEALED_KEYS.has(key)) return `${path} contains an unexpected field "${key}"`;
  }
  if (typeof value.ct !== 'string' || value.ct.length === 0 || value.ct.length > 48_000) {
    return `${path}.ct must be a ciphertext string`;
  }
  if (typeof value.iv !== 'string' || value.iv.length === 0 || value.iv.length > 256) {
    return `${path}.iv must be an IV string`;
  }
  if (value.alg !== undefined && (typeof value.alg !== 'string' || value.alg.length > 32)) {
    return `${path}.alg is invalid`;
  }
  return null;
}

export async function listConversations(req, res) {
  const me = new mongoose.Types.ObjectId(req.userId);
  const rows = await Message.aggregate([
    { $match: { $or: [{ senderId: me }, { recipientId: me }] } },
    {
      $project: {
        peer: { $cond: [{ $eq: ['$senderId', me] }, '$recipientId', '$senderId'] },
        mine: { $eq: ['$senderId', me] },
        readAt: 1,
        createdAt: 1
      }
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$peer',
        lastMine: { $first: '$mine' },
        lastAt: { $first: '$createdAt' },
        unread: {
          $sum: { $cond: [{ $and: [{ $eq: ['$mine', false] }, { $eq: ['$readAt', null] }] }, 1, 0] }
        }
      }
    },
    { $sort: { lastAt: -1 } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'peer' } },
    { $unwind: '$peer' },
    {
      $project: {
        _id: 0,
        peerId: '$_id',
        peerName: { $ifNull: ['$peer.username', 'unknown'] },
        peerAvatar: { $ifNull: ['$peer.avatar', ''] },
        peerHasKey: { $toBool: { $ifNull: ['$peer.activeKey', null] } },
        lastMine: 1,
        lastAt: 1,
        unread: 1
      }
    }
  ]);

  res.json({
    conversations: rows.map((r) => ({
      peerId: String(r.peerId),
      peerName: r.peerName,
      peerAvatar: r.peerAvatar,
      peerHasKey: r.peerHasKey,
      lastMine: r.lastMine,
      lastAt: r.lastAt,
      unread: Number(r.unread) || 0
    }))
  });
}

export async function getThread(req, res) {
  const peerId = req.params.userId;
  if (!mongoose.isValidObjectId(peerId)) return res.status(400).json({ error: 'Invalid user id' });

  const filter = {
    $or: [
      { senderId: req.userId, recipientId: peerId },
      { senderId: peerId, recipientId: req.userId }
    ]
  };
  const before = req.query.before;
  if (before && mongoose.isValidObjectId(before)) {
    const cursor = await Message.findById(before).select('createdAt').lean();
    if (cursor) filter.$or.forEach((clause) => (clause.createdAt = { $lt: cursor.createdAt }));
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || THREAD_PAGE, 1), THREAD_MAX);

  const messages = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  const docs = messages.reverse().map((m) => ({
    id: String(m._id),
    mine: String(m.senderId) === req.userId,
    payload: m.payload,
    keyId: m.keyId || '',
    read: Boolean(m.readAt),
    createdAt: m.createdAt
  }));

  res.json({ messages: docs });
}

export async function send(req, res) {
  const recipientId = req.params.userId;
  if (!mongoose.isValidObjectId(recipientId)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (String(recipientId) === String(req.userId)) {
    return res.status(400).json({ error: 'You cannot message yourself' });
  }

  const recipient = await User.findById(recipientId).select('activeKey').lean();
  if (!recipient) return res.status(404).json({ error: 'No such user' });
  if (!recipient.activeKey) {
    return res.status(400).json({ error: 'Recipient has not set up encryption yet' });
  }

  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'text')) {
    return res.status(400).json({ error: 'Plaintext fields are not accepted' });
  }

  const forSender = validateSealed(req.body?.forSender, 'forSender');
  const forRecipient = validateSealed(req.body?.forRecipient, 'forRecipient');
  if (forSender) return res.status(400).json({ error: forSender });
  if (forRecipient) return res.status(400).json({ error: forRecipient });

  const keyId = req.body?.keyId;
  if (typeof keyId === 'string' && !/^[0-9a-f]{64}$/.test(keyId)) {
    return res.status(400).json({ error: 'keyId must be the 64-hex fingerprint of the key used' });
  }

  const message = await Message.create({
    senderId: req.userId,
    recipientId,
    payload: {
      forSender: { ct: req.body.forSender.ct, iv: req.body.forSender.iv, alg: req.body.forSender.alg || 'AES-GCM' },
      forRecipient: { ct: req.body.forRecipient.ct, iv: req.body.forRecipient.iv, alg: req.body.forRecipient.alg || 'AES-GCM' }
    },
    keyId: keyId || '',
    readAt: null
  });

  const doc = await Message.findById(message._id).lean();
  const payload = {
    id: String(doc._id),
    mine: false,
    payload: doc.payload,
    keyId: doc.keyId || '',
    read: Boolean(doc.readAt),
    createdAt: doc.createdAt
  };

  const senderRoom = `user:${req.userId}`;
  const recipientRoom = `user:${recipientId}`;
  if (req.app.get('io')) {
    req.app.get('io').to(senderRoom).emit('message:new', payload);
    req.app.get('io').to(recipientRoom).emit('message:new', payload);
  }

  res.status(201).json({ message: { ...payload, mine: String(doc.senderId) === req.userId } });
}

export async function markRead(req, res) {
  const messageId = req.params.id;
  if (!mongoose.isValidObjectId(messageId)) return res.status(400).json({ error: 'Invalid message id' });

  const message = await Message.findOne({ _id: messageId, recipientId: req.userId });
  if (!message) return res.status(404).json({ error: 'Message not found in your inbox' });

  if (!message.readAt) {
    message.readAt = new Date();
    await message.save();
    if (req.app.get('io')) {
      req.app.get('io')
        .to(`user:${message.senderId}`)
        .emit('read:update', { id: String(message._id), readAt: message.readAt });
    }
  }

  res.json({ id: String(message._id), read: Boolean(message.readAt) });
}