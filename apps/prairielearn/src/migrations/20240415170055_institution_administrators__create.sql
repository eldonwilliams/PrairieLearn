CREATE TABLE IF NOT EXISTS institution_administrators (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  institution_id BIGINT NOT NULL REFERENCES institutions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (user_id, institution_id)
);
