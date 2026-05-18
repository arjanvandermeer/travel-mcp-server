-- Add hashed API token storage. The application migrates legacy plaintext
-- token rows on successful authentication so this migration can run safely
-- without knowing existing token values.

ALTER TABLE IF EXISTS user_tokens
    ALTER COLUMN token DROP NOT NULL;

ALTER TABLE IF EXISTS user_tokens
    ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);

ALTER TABLE IF EXISTS user_tokens
    ADD COLUMN IF NOT EXISTS token_prefix VARCHAR(12);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tokens_token_hash
ON user_tokens(token_hash)
WHERE token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_tokens_token
ON user_tokens(token)
WHERE token IS NOT NULL AND revoked_at IS NULL;
