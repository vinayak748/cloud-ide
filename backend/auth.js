const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_EXPIRES_IN = "7d";
const SALT_ROUNDS = 10;

// Checked lazily (not at module load) so the server can still boot and
// serve /run without JWT_SECRET set — only auth-related calls fail, with
// a clear error, rather than crashing the whole process at startup.
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Add it to backend/.env (see .env.example)."
    );
  }
  return secret;
}

async function hashPassword(plainTextPassword) {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

async function comparePassword(plainTextPassword, passwordHash) {
  return bcrypt.compare(plainTextPassword, passwordHash);
}

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), username: user.username },
    getSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  // Throws if invalid/expired/misconfigured — callers should catch this.
  return jwt.verify(token, getSecret());
}

module.exports = { hashPassword, comparePassword, signToken, verifyToken };
