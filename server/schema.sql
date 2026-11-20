CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  display_name text NOT NULL,
  password_hash text,
  is_demo boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS learner_subjects (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject text NOT NULL,
  level text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  PRIMARY KEY (account_id, subject)
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject text NOT NULL,
  title text NOT NULL DEFAULT '新对话',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_by_subject
  ON conversations(account_id, subject, updated_at DESC);

CREATE TABLE IF NOT EXISTS turns (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  reply text,
  cost integer NOT NULL CHECK (cost > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_single_active_turn
  ON turns(conversation_id) WHERE status = 'running';

-- Retired billing storage: retained only to preserve historical records.
-- Active application flows do not create wallets or write ledger entries.
CREATE TABLE IF NOT EXISTS wallets (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance integer NOT NULL CHECK (balance >= 0),
  held integer NOT NULL DEFAULT 0 CHECK (held >= 0 AND held <= balance)
);

CREATE TABLE IF NOT EXISTS credit_entries (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  turn_id uuid UNIQUE REFERENCES turns(id),
  amount integer NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attempts (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject text NOT NULL,
  question_id text NOT NULL,
  choice integer NOT NULL,
  correct boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, subject, question_id)
);

-- Additive migration: preserve existing accounts, histories and credit entries.
ALTER TABLE turns ADD COLUMN IF NOT EXISTS presentation jsonb;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS learning_revision integer;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS intent text;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS display_prompt text;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS teacher_decision jsonb;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS user_image text;

CREATE TABLE IF NOT EXISTS learning_sessions (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0,
  state jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_text text,
  presentation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_messages_by_conversation ON learning_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS learning_events (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  fingerprint text NOT NULL,
  revision integer NOT NULL,
  evidence jsonb,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, request_key)
);

CREATE TABLE IF NOT EXISTS learning_observations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  kind text NOT NULL,
  claim text NOT NULL,
  source_id text NOT NULL,
  source_excerpt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS observations_by_subject ON learning_observations(account_id, subject, created_at DESC);

-- A parent owns the wallet; each child owns independent subject progress.
CREATE TABLE IF NOT EXISTS learners (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO learners (id, account_id, name) SELECT id, id, '我的学习档案' FROM accounts ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'learner_subjects' AND column_name = 'account_id') THEN
    ALTER TABLE learner_subjects DROP CONSTRAINT learner_subjects_account_id_fkey;
    ALTER TABLE learner_subjects RENAME COLUMN account_id TO learner_id;
    ALTER TABLE learner_subjects ADD FOREIGN KEY (learner_id) REFERENCES learners(id);
    ALTER TABLE attempts DROP CONSTRAINT attempts_account_id_fkey;
    ALTER TABLE attempts RENAME COLUMN account_id TO learner_id;
    ALTER TABLE attempts ADD FOREIGN KEY (learner_id) REFERENCES learners(id);
  END IF;
END $$;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS learner_id uuid REFERENCES learners(id);
UPDATE conversations SET learner_id = account_id WHERE learner_id IS NULL;
ALTER TABLE conversations ALTER COLUMN learner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_by_learner ON conversations(learner_id, subject, updated_at DESC);
ALTER TABLE learning_observations ADD COLUMN IF NOT EXISTS learner_id uuid REFERENCES learners(id);
UPDATE learning_observations SET learner_id = account_id WHERE learner_id IS NULL;
ALTER TABLE learning_observations ALTER COLUMN learner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS observations_by_learner ON learning_observations(learner_id, subject, created_at DESC);

CREATE TABLE IF NOT EXISTS homework_pages (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  learner_id uuid NOT NULL REFERENCES learners(id),
  subject text NOT NULL,
  level text NOT NULL DEFAULT '',
  request_key uuid NOT NULL,
  fingerprint text NOT NULL,
  image bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  cost integer NOT NULL CHECK (cost > 0),
  attempt integer NOT NULL DEFAULT 1,
  retry_key uuid,
  error text,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, request_key)
);
CREATE TABLE IF NOT EXISTS homework_questions (
  id uuid PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES homework_pages(id),
  number text NOT NULL,
  text text NOT NULL,
  student_answer text NOT NULL,
  correct_answer text NOT NULL,
  explanation text NOT NULL,
  knowledge_hint text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('correct','wrong','uncertain')),
  confidence real NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source_question_id uuid REFERENCES homework_questions(id);
ALTER TABLE homework_questions ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_homework_source ON conversations(source_question_id) WHERE source_question_id IS NOT NULL;
ALTER TABLE credit_entries ADD COLUMN IF NOT EXISTS homework_page_id uuid REFERENCES homework_pages(id);
CREATE UNIQUE INDEX IF NOT EXISTS credit_homework_once ON credit_entries(homework_page_id) WHERE homework_page_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS homework_reflections (
  id uuid PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES homework_questions(id),
  request_key uuid NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, request_key)
);
CREATE TABLE IF NOT EXISTS homework_reviews (
  question_id uuid PRIMARY KEY REFERENCES homework_questions(id),
  due_at timestamptz NOT NULL DEFAULT now(),
  last_submitted_at timestamptz
);

-- V1.0 Platform Architecture: Goals, Task Tree, Append-only Events/Evidence, Skill Projections, Observability
ALTER TABLE turns ADD COLUMN IF NOT EXISTS task_id uuid;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS teaching_intent text;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS skill_versions jsonb;

CREATE TABLE IF NOT EXISTS skill_definitions (
  id text PRIMARY KEY,
  subject text NOT NULL,
  title text NOT NULL,
  scope text NOT NULL DEFAULT '',
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  version text NOT NULL DEFAULT '1.0',
  status text NOT NULL DEFAULT 'published',
  source_type text NOT NULL DEFAULT 'curated'
);

CREATE TABLE IF NOT EXISTS prerequisite_relations (
  id text PRIMARY KEY,
  from_skill text NOT NULL REFERENCES skill_definitions(id) ON DELETE CASCADE,
  to_skill text NOT NULL REFERENCES skill_definitions(id) ON DELETE CASCADE,
  strength text NOT NULL CHECK (strength IN ('hard', 'soft')),
  source text NOT NULL DEFAULT 'curated_v1',
  version text NOT NULL DEFAULT '1.0'
);

CREATE TABLE IF NOT EXISTS learning_goals (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  subject text NOT NULL,
  title text NOT NULL,
  topic text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'free_input',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  root_task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_tasks (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES learning_goals(id) ON DELETE SET NULL,
  parent_task_id uuid,
  skill_id text,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('created', 'active', 'paused', 'completed', 'canceled', 'needs_review')),
  depth integer NOT NULL DEFAULT 0,
  pause_reason text NOT NULL DEFAULT '',
  resume_frame jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_tasks_by_conv ON learning_tasks(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS interaction_instances (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  task_id uuid,
  component_type text NOT NULL,
  schema_version text NOT NULL DEFAULT '1.0',
  config jsonb NOT NULL,
  draft_snapshot jsonb,
  committed_snapshot jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only interaction facts
CREATE TABLE IF NOT EXISTS interaction_events (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  instance_id uuid,
  actor text NOT NULL CHECK (actor IN ('learner', 'system')),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS interaction_events_by_conv ON interaction_events(conversation_id, occurred_at DESC);

-- Append-only learning evidence (never overwritten by latest projection)
CREATE TABLE IF NOT EXISTS learning_evidence (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  subject text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id uuid,
  event_id uuid,
  skill_id text NOT NULL,
  fact text NOT NULL,
  inference text NOT NULL DEFAULT '',
  verdict text NOT NULL CHECK (verdict IN ('correct', 'incorrect', 'partial', 'uncertain', 'observed')),
  confidence real NOT NULL DEFAULT 0.5,
  rule_version text NOT NULL DEFAULT 'none',
  model_version text NOT NULL DEFAULT 'none',
  evidence_source text NOT NULL CHECK (evidence_source IN ('rule_engine', 'llm_semantic', 'self_report')),
  submission_key text,
  superseded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, submission_key)
);
CREATE INDEX IF NOT EXISTS learning_evidence_by_skill ON learning_evidence(learner_id, skill_id, created_at DESC);
ALTER TABLE learning_evidence ADD COLUMN IF NOT EXISTS assessment jsonb;

-- Rebuildable skill state projection + audit trail
CREATE TABLE IF NOT EXISTS skill_states (
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('unobserved', 'emerging', 'understood', 'validated', 'review_needed')),
  confidence real NOT NULL DEFAULT 0,
  last_verified_at timestamptz,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_misconceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, skill_id)
);

CREATE TABLE IF NOT EXISTS skill_state_audit (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  from_level text NOT NULL,
  to_level text NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  evidence_id uuid,
  conflict_rejected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_state_audit_by_learner ON skill_state_audit(learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  request_id uuid,
  turn_id uuid,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  learner_id uuid REFERENCES learners(id) ON DELETE CASCADE,
  prompt_version text NOT NULL,
  skill_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_id text NOT NULL,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_result text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('completed', 'failed', 'aborted')),
  error_code text NOT NULL DEFAULT '',
  redacted_summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_by_time ON agent_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS learning_recommendations (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  subject text NOT NULL,
  skill_id text NOT NULL,
  suggested_action text NOT NULL,
  reason_text text NOT NULL,
  reason_evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id uuid PRIMARY KEY,
  actor_account_id uuid,
  target_resource text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Billing removal: keep historical values, but new learning records have no cost.
ALTER TABLE turns ALTER COLUMN cost DROP NOT NULL;
ALTER TABLE homework_pages ALTER COLUMN cost DROP NOT NULL;
