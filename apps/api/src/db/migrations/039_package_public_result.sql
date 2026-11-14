ALTER TABLE game_packages
  ADD COLUMN public_result_contract text
  CHECK (public_result_contract IS NULL OR public_result_contract = 'winners-scores-v1');
