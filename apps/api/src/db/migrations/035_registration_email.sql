ALTER TABLE accounts ADD COLUMN email_canonical text;
ALTER TABLE accounts ADD COLUMN email_verified_at timestamptz;
CREATE UNIQUE INDEX accounts_email_canonical_unique ON accounts(email_canonical) WHERE email_canonical IS NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT accounts_email_verified_pair CHECK
  ((email_canonical IS NULL) = (email_verified_at IS NULL));

CREATE TABLE registration_email_challenges (
  email_canonical text PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  send_count integer NOT NULL DEFAULT 1 CHECK (send_count BETWEEN 1 AND 5)
);
