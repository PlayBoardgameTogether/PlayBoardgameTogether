-- Keep old offer identities and billing references immutable after editing/removal.
ALTER TABLE official_ai_offers ADD COLUMN deleted_at timestamptz;
ALTER TABLE official_ai_offers ADD CONSTRAINT official_ai_deleted_disabled
  CHECK (deleted_at IS NULL OR NOT enabled);
