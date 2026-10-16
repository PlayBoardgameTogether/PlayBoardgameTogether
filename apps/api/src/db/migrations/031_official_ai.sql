-- Official AI uses the existing model controller and action transaction.
CREATE TABLE official_ai_offers (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  source_profile_id uuid NOT NULL REFERENCES model_profiles(id),
  points_per_action integer NOT NULL CHECK (points_per_action BETWEEN 1 AND 10000),
  enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO provider_endpoints(id,display_name,protocol,base_url,capabilities)
VALUES('official-ai','PlayBoard 官方 AI','mock','mock://local','{"internal":true}')
ON CONFLICT DO NOTHING;
ALTER TABLE model_profiles ADD COLUMN official_offer_id uuid REFERENCES official_ai_offers(id);
ALTER TABLE model_profiles ADD COLUMN official_match_budget integer;
ALTER TABLE model_profiles ADD CONSTRAINT official_profile_shape CHECK (
  (official_offer_id IS NULL AND official_match_budget IS NULL AND endpoint_id <> 'official-ai') OR
  (official_offer_id IS NOT NULL AND official_match_budget IS NOT NULL AND official_match_budget BETWEEN 1 AND 1000000
    AND endpoint_id='official-ai' AND credential_id IS NULL)
);
CREATE UNIQUE INDEX official_profile_owner_offer ON model_profiles(owner_account_id,official_offer_id)
  WHERE official_offer_id IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE ai_point_wallets (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  balance integer NOT NULL DEFAULT 0 CHECK (balance BETWEEN 0 AND 1000000000)
);
CREATE TABLE ai_point_ledger (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  kind text NOT NULL CHECK (kind IN ('grant','action')),
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 200),
  match_id uuid REFERENCES matches(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_point_ledger_account_date ON ai_point_ledger(account_id,created_at DESC,id DESC);
CREATE TABLE ai_point_receipts (
  account_id uuid NOT NULL REFERENCES accounts(id),
  request_id uuid NOT NULL,
  input jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(account_id,request_id)
);
CREATE TABLE official_ai_reservations (
  task_id uuid PRIMARY KEY REFERENCES ai_tasks(id),
  attempt_id uuid NOT NULL UNIQUE REFERENCES model_attempts(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  offer_id uuid NOT NULL REFERENCES official_ai_offers(id),
  match_id uuid NOT NULL REFERENCES matches(id),
  seat_id uuid NOT NULL,
  points integer NOT NULL CHECK (points > 0),
  status text NOT NULL CHECK (status IN ('reserved','ready','charged','released')),
  ledger_id uuid UNIQUE REFERENCES ai_point_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='charged') = (ledger_id IS NOT NULL))
);
CREATE INDEX official_ai_reservations_wallet ON official_ai_reservations(account_id,status);
CREATE INDEX official_ai_reservations_match ON official_ai_reservations(match_id,seat_id,account_id);
