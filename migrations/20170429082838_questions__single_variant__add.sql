ALTER TABLE questions
ADD COLUMN IF NOT EXISTS single_variant BOOLEAN DEFAULT FALSE;
