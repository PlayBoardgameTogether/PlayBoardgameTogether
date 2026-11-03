CREATE TABLE account_security_challenges (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('bind-email', 'reset-password')),
  id uuid NOT NULL UNIQUE,
  email_canonical text NOT NULL,
  password_hash_at_issue text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  PRIMARY KEY (account_id, purpose)
);

-- Shared mailbox budget across binding/recovery, including failed deliveries.
CREATE TABLE account_security_mail_limits (
  email_canonical text PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  send_count integer NOT NULL DEFAULT 1 CHECK (send_count BETWEEN 1 AND 5)
);
