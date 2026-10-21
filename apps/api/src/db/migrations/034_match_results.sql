-- Historical matches retain NULL; no rule versions or saved States are rewritten.
ALTER TABLE matches ADD COLUMN result_summary jsonb;
ALTER TABLE matches ADD CONSTRAINT matches_result_summary_finished
  CHECK (result_summary IS NULL OR (status = 'finished' AND jsonb_typeof(result_summary) = 'object'));
