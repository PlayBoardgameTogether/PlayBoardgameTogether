CREATE TABLE player_badge_settings (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  displayed jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(displayed) = 'array' AND jsonb_array_length(displayed) <= 3)
);
CREATE TABLE player_badge_grants (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  badge_id text NOT NULL CHECK (badge_id IN ('beta-player', 'contributor', 'event-honor')),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  awarded_by uuid NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (account_id, badge_id)
);
CREATE TABLE player_badge_receipts (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  input jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, request_id)
);
