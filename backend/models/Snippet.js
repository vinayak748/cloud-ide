const mongoose = require("mongoose");

const snippetSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      default: "Untitled snippet",
    },
    language: {
      type: String,
      required: true,
      enum: ["javascript", "python"],
    },
    code: {
      type: String,
      required: true,
      maxlength: 50000,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Snippet", snippetSchema);
