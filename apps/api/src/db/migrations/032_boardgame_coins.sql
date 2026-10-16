-- Platform currency is independent of AI point wallets and reservations.
CREATE TABLE boardgame_coin_wallets (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance BETWEEN 0 AND 1000000000),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE boardgame_coin_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES boardgame_coin_wallets(account_id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  delta integer NOT NULL CHECK (delta <> 0 AND delta BETWEEN -1000000000 AND 1000000000),
  balance_after integer NOT NULL CHECK (balance_after BETWEEN 0 AND 1000000000),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 200 AND reason = btrim(reason)),
  actor_account_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, revision),
  UNIQUE (actor_account_id, request_id)
);
