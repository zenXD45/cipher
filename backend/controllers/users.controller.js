import { User } from '../models/User.js';
import { sanitizeAvatar, validateUsername } from './auth.controller.js';

function profileFor(user) {
  return {
    id: String(user._id),
    username: user.username,
    avatar: user.avatar || '',
    hasKey: Boolean(user.activeKey),
    publicKey: user.activeKey
      ? { spki: user.activeKey.spki, fingerprint: user.activeKey.fingerprint }
      : null,
    createdAt: user.createdAt
  };
}

export async function searchUsers(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const filter = { _id: { $ne: req.userId } };
  if (q) filter.username = { $regex: `^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' };

  const users = await User.find(filter)
    .select('username avatar activeKey createdAt')
    .sort({ username: 1 })
    .limit(25)
    .lean();

  res.json({
    users: users.map((u) => ({
      id: String(u._id),
      username: u.username,
      avatar: u.avatar || '',
      hasKey: Boolean(u.activeKey)
    })),
    total: users.length
  });
}

export async function getUser(req, res) {
  const user = await User.findById(req.params.id).select('username avatar activeKey createdAt').lean();
  if (!user) return res.status(404).json({ error: 'No such user' });
  res.json({ user: profileFor(user) });
}

export async function updateAccount(req, res) {
  const patch = {};
  if (req.body.username !== undefined) {
    const username = String(req.body.username).trim().toLowerCase();
    const error = validateUsername(username);
    if (error) return res.status(400).json({ error });
    if (username !== req.user.username) {
      const taken = await User.exists({ username });
      if (taken) return res.status(409).json({ error: 'That username is taken' });
    }
    patch.username = username;
  }
  if (req.body.avatar !== undefined) patch.avatar = sanitizeAvatar(req.body.avatar);

  const user = await User.findByIdAndUpdate(req.userId, { $set: patch }, { new: true }).lean();
  res.json({ user: { id: String(user._id), username: user.username, avatar: user.avatar || '' } });
}