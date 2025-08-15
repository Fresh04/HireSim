const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '7d'; 

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in environment. register route will fail without it.');
}

router.post('/', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const usersCol = global.db.collection('users');

    const existing = await usersCol.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ message: 'User with that email already exists.' });
    }

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);

    const userDoc = {
      email: email.toLowerCase().trim(),
      password: hashed,
      name: name ? String(name).trim() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCol.insertOne(userDoc);

    if (!process.env.JWT_SECRET) {
      console.error('Missing JWT_SECRET — cannot sign token.');
      return res.status(500).json({ message: 'Server misconfiguration (missing JWT secret).' });
    }

    const payload = { id: result.insertedId.toString(), email: userDoc.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: payload.id, email: payload.email, name: userDoc.name }
    });
  } catch (err) {
    console.error('Error in /register:', err);
    return res.status(500).json({ message: 'Failed to register user' });
  }
});

module.exports = router;
