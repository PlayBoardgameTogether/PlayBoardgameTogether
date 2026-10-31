CREATE TABLE registration_mail_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL,
  host text NOT NULL,
  port integer NOT NULL CHECK (port IN (465,587)),
  username text NOT NULL,
  sender_address text NOT NULL,
  password_ciphertext bytea,
  password_nonce bytea,
  password_tag bytea,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  CHECK ((password_ciphertext IS NULL AND password_nonce IS NULL AND password_tag IS NULL)
    OR (password_ciphertext IS NOT NULL AND password_nonce IS NOT NULL AND password_tag IS NOT NULL
      AND octet_length(password_nonce)=12 AND octet_length(password_tag)=16))
);
CREATE TABLE registration_mail_test_limit (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  requested_at timestamptz
);
INSERT INTO registration_mail_test_limit(singleton) VALUES(true);
