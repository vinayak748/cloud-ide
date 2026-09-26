const express = require("express");
const Snippet = require("../models/Snippet");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

// Every route below requires a valid JWT, and every query is scoped to
// req.userId — so one user can never read or modify another user's
// snippets, even if they guess a valid snippet id.
router.use(requireAuth);

router.get("/", async (req, res) => {
  const snippets = await Snippet.find({ owner: req.userId })
    .sort({ updatedAt: -1 })
    .select("title language updatedAt"); // list view: skip the full code body
  res.json(snippets);
});

router.get("/:id", async (req, res) => {
  try {
    const snippet = await Snippet.findOne({ _id: req.params.id, owner: req.userId });
    if (!snippet) return res.status(404).json({ error: "Snippet not found." });
    res.json(snippet);
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ error: "Invalid snippet id." });
    }
    res.status(500).json({ error: "Failed to load snippet." });
  }
});

router.post("/", async (req, res) => {
  const { title, language, code } = req.body || {};
  if (!["javascript", "python"].includes(language)) {
    return res.status(400).json({ error: "language must be javascript or python." });
  }
  if (typeof code !== "string") {
    return res.status(400).json({ error: "code is required." });
  }

  try {
    const snippet = await Snippet.create({
      owner: req.userId,
      title: title || "Untitled snippet",
      language,
      code,
    });
    res.status(201).json(snippet);
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ error: "Invalid snippet data." });
    }
    res.status(500).json({ error: "Failed to save snippet." });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { title, code } = req.body || {};
    const snippet = await Snippet.findOneAndUpdate(
      { _id: req.params.id, owner: req.userId },
      { ...(title !== undefined && { title }), ...(code !== undefined && { code }) },
      { new: true, runValidators: true }
    );
    if (!snippet) return res.status(404).json({ error: "Snippet not found." });
    res.json(snippet);
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ error: "Invalid snippet id." });
    }
    res.status(500).json({ error: "Failed to update snippet." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await Snippet.findOneAndDelete({ _id: req.params.id, owner: req.userId });
    if (!result) return res.status(404).json({ error: "Snippet not found." });
    res.status(204).send();
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ error: "Invalid snippet id." });
    }
    res.status(500).json({ error: "Failed to delete snippet." });
  }
});

module.exports = router;
