import mongoose, { Schema } from "mongoose";

const codeBlockSchema = new mongoose.Schema({
    shareId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    filename: String,
    content: String,
     // Add index for faster lookups
    expiresIn: {
        type: String,
        enum: ['1m', '1h', '24h', '2d', '3d'], // Updated options
        default: '1h'
    },
    expiresAt: {
        type: Date,
        required: true,
        default: () => new Date(Date.now() + 3600000) // 1 hour from now
    },
});

codeBlockSchema.pre('save', function(next) {
  const durationMap = {
    '1m': 60000,       // 1 minute
    '1h': 3600000,     // 1 hour
    '24h': 86400000,   // 24 hours
    '2d': 172800000,   // 2 days (48 hours)
    '3d': 259200000    // 3 days (72 hours)
  };
  
  if (this.isModified('expiresIn') || this.isNew) {
    this.expiresAt = new Date(Date.now() + durationMap[this.expiresIn]);
  }
  next();
});
// Add to codeBlockSchema
codeBlockSchema.statics.updateContent = async function (shareId, content) {
  return this.findOneAndUpdate(
    { shareId },
    { content },
    { new: true, select: 'content' }
  );
};
codeBlockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
codeBlockSchema.statics.generateShareId = async function () {
    const generateId = () => Math.random().toString(36).substring(2, 10);
    let shareId = generateId();
    let exists = await this.findOne({ shareId });

    while (exists) {
        shareId = generateId();
        exists = await this.findOne({ shareId });
    }

    return shareId;
};
export const CodeBlock = mongoose.models.CodeBlock || mongoose.model("CodeBlock", codeBlockSchema);
