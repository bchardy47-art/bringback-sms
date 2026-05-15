-- Add taken_over_by to conversations (references users.id)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS taken_over_by uuid REFERENCES users(id);
