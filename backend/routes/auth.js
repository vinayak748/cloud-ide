const express = require("express");
const User = require("../models/User");
const { hashPassword, comparePassword, signToken } = require("../auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || username.trim().length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters." });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    const existing = await User.findOne({ username: username.trim() });
    if (existing) {
      return res.status(409).json({ error: "That username is already taken." });
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({ username: username.trim(), passwordHash });

    const token = signToken(user);
    res.status(201).json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: "Registration failed." });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password are required." });
  }

  try {
    const user = await User.findOne({ username: username.trim() });
    // Deliberately vague error for both "no such user" and "wrong password"
    // so login failures don't reveal which usernames exist.
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const token = signToken(user);
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: "Login failed." });
  }
});

module.exports = router;
