BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS knowledge;
CREATE SCHEMA IF NOT EXISTS runtime;
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE knowledge.sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type text NOT NULL CHECK (source_type IN (
        'manufacturer', 'regulation', 'standard', 'licensed_database',
        'technical_publication', 'community', 'observed_session', 'internal'
    )),
    publisher text NOT NULL,
    title text NOT NULL,
    url text,
    external_version text,
    language_code text NOT NULL DEFAULT 'en',
    published_at timestamptz,
    retrieved_at timestamptz NOT NULL DEFAULT now(),
    license_name text,
    license_url text,
    redistribution_allowed boolean NOT NULL DEFAULT false,
    trust_tier smallint NOT NULL CHECK (trust_tier BETWEEN 1 AND 5),
    lifecycle_status text NOT NULL DEFAULT 'active'
        CHECK (lifecycle_status IN ('candidate', 'active', 'superseded', 'rejected')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
    document_type text NOT NULL,
    title text NOT NULL,
    storage_uri text NOT NULL,
    mime_type text NOT NULL,
    content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-fA-F]{64}$'),
    extraction_status text NOT NULL DEFAULT 'pending'
        CHECK (extraction_status IN ('pending', 'processing', 'ready', 'failed', 'quarantined')),
    parser_version text,
    page_count integer CHECK (page_count IS NULL OR page_count > 0),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (content_sha256)
);

CREATE TABLE knowledge.document_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    content text NOT NULL,
    token_count integer CHECK (token_count IS NULL OR token_count >= 0),
    locator jsonb NOT NULL DEFAULT '{}'::jsonb,
    heading_path text[],
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, ordinal)
);

CREATE TABLE knowledge.retrieval_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('openai_vector_store', 'pgvector', 'other')),
    external_store_id text,
    external_file_id text,
    index_status text NOT NULL DEFAULT 'pending'
        CHECK (index_status IN ('pending', 'processing', 'ready', 'failed', 'deleted')),
    indexed_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (provider, external_store_id, external_file_id)
);

CREATE TABLE catalog.manufacturers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    normalized_name text NOT NULL UNIQUE,
    country_code char(2),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog.vehicle_models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id uuid NOT NULL REFERENCES catalog.manufacturers(id) ON DELETE RESTRICT,
    name text NOT NULL,
    normalized_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (manufacturer_id, normalized_name)
);

CREATE TABLE catalog.model_generations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id uuid NOT NULL REFERENCES catalog.vehicle_models(id) ON DELETE RESTRICT,
    generation_code text,
    platform_code text,
    display_name text NOT NULL,
    production_start date,
    production_end date,
    market_codes text[] NOT NULL DEFAULT '{}',
    lifecycle_status text NOT NULL DEFAULT 'candidate'
        CHECK (lifecycle_status IN ('candidate', 'published', 'deprecated')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (production_end IS NULL OR production_start IS NULL OR production_end >= production_start)
);

CREATE TABLE catalog.engines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id uuid REFERENCES catalog.manufacturers(id) ON DELETE RESTRICT,
    engine_code text NOT NULL,
    normalized_code text NOT NULL,
    display_name text NOT NULL,
    fuel_type text CHECK (fuel_type IN ('petrol', 'diesel', 'hybrid', 'electric', 'lpg', 'other')),
    displacement_cc integer CHECK (displacement_cc IS NULL OR displacement_cc > 0),
    cylinder_count smallint CHECK (cylinder_count IS NULL OR cylinder_count BETWEEN 1 AND 16),
    induction text CHECK (induction IN ('naturally_aspirated', 'turbo', 'supercharged', 'twincharged', 'electric', 'other')),
    lifecycle_status text NOT NULL DEFAULT 'candidate'
        CHECK (lifecycle_status IN ('candidate', 'published', 'deprecated')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (manufacturer_id, normalized_code)
);

CREATE TABLE catalog.engine_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    engine_id uuid NOT NULL REFERENCES catalog.engines(id) ON DELETE CASCADE,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    source_id uuid REFERENCES knowledge.sources(id) ON DELETE SET NULL,
    UNIQUE (engine_id, normalized_alias)
);

CREATE TABLE catalog.vehicle_variants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    generation_id uuid NOT NULL REFERENCES catalog.model_generations(id) ON DELETE RESTRICT,
    engine_id uuid NOT NULL REFERENCES catalog.engines(id) ON DELETE RESTRICT,
    display_name text NOT NULL,
    model_year_start smallint CHECK (model_year_start IS NULL OR model_year_start BETWEEN 1886 AND 2200),
    model_year_end smallint CHECK (model_year_end IS NULL OR model_year_end BETWEEN 1886 AND 2200),
    body_style text,
    transmission_code text,
    drivetrain text,
    market_code text,
    vin_pattern text,
    lifecycle_status text NOT NULL DEFAULT 'candidate'
        CHECK (lifecycle_status IN ('candidate', 'published', 'deprecated')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (model_year_end IS NULL OR model_year_start IS NULL OR model_year_end >= model_year_start)
);

CREATE TABLE catalog.diagnostic_protocols (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    standard_name text NOT NULL,
    transport text NOT NULL,
    addressing text,
    bitrate_kbps integer CHECK (bitrate_kbps IS NULL OR bitrate_kbps > 0),
    elm_identifier text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (standard_name, transport, addressing, bitrate_kbps)
);

CREATE TABLE catalog.ecu_families (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer_id uuid REFERENCES catalog.manufacturers(id) ON DELETE RESTRICT,
    supplier text,
    family_name text NOT NULL,
    module_type text NOT NULL,
    hardware_pattern text,
    software_pattern text,
    lifecycle_status text NOT NULL DEFAULT 'candidate'
        CHECK (lifecycle_status IN ('candidate', 'published', 'deprecated')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog.module_installations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_variant_id uuid NOT NULL REFERENCES catalog.vehicle_variants(id) ON DELETE CASCADE,
    ecu_family_id uuid NOT NULL REFERENCES catalog.ecu_families(id) ON DELETE RESTRICT,
    protocol_id uuid REFERENCES catalog.diagnostic_protocols(id) ON DELETE RESTRICT,
    logical_address text,
    can_request_id text,
    can_response_id text,
    lifecycle_status text NOT NULL DEFAULT 'candidate'
        CHECK (lifecycle_status IN ('candidate', 'published', 'deprecated')),
    UNIQUE (vehicle_variant_id, ecu_family_id, logical_address)
);

CREATE TABLE catalog.diagnostic_parameters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace text NOT NULL CHECK (namespace IN ('obd2_standard', 'manufacturer_enhanced', 'derived')),
    service_mode text,
    pid_code text,
    canonical_key text NOT NULL UNIQUE,
    display_name_pl text NOT NULL,
    display_name_en text,
    unit text,
    decoder_key text NOT NULL,
    formula_text text,
    byte_length smallint CHECK (byte_length IS NULL OR byte_length BETWEEN 1 AND 64),
    minimum_value numeric,
    maximum_value numeric,
    sample_priority smallint NOT NULL DEFAULT 3 CHECK (sample_priority BETWEEN 1 AND 5),
    safety_class text NOT NULL DEFAULT 'read_only'
        CHECK (safety_class IN ('read_only', 'restricted', 'forbidden')),
    lifecycle_status text NOT NULL DEFAULT 'candidate'
        CHECK (lifecycle_status IN ('candidate', 'verified', 'published', 'deprecated', 'rejected')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (namespace, service_mode, pid_code)
);

CREATE TABLE catalog.parameter_applicability (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parameter_id uuid NOT NULL REFERENCES catalog.diagnostic_parameters(id) ON DELETE CASCADE,
    vehicle_variant_id uuid REFERENCES catalog.vehicle_variants(id) ON DELETE CASCADE,
    engine_id uuid REFERENCES catalog.engines(id) ON DELETE CASCADE,
    ecu_family_id uuid REFERENCES catalog.ecu_families(id) ON DELETE CASCADE,
    support_status text NOT NULL CHECK (support_status IN ('supported', 'unsupported', 'conditional', 'unknown')),
    conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    evidence_level smallint NOT NULL DEFAULT 1 CHECK (evidence_level BETWEEN 1 AND 5),
    valid_from date,
    valid_to date,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(vehicle_variant_id, engine_id, ecu_family_id) >= 1),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE TABLE catalog.diagnostic_trouble_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace text NOT NULL CHECK (namespace IN ('sae', 'manufacturer')),
    code text NOT NULL,
    title_pl text NOT NULL,
    title_en text,
    description_pl text,
    system_area text,
    lifecycle_status text NOT NULL DEFAULT 'candidate'
        CHECK (lifecycle_status IN ('candidate', 'verified', 'published', 'deprecated', 'rejected')),
    UNIQUE (namespace, code)
);

CREATE TABLE catalog.dtc_applicability (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dtc_id uuid NOT NULL REFERENCES catalog.diagnostic_trouble_codes(id) ON DELETE CASCADE,
    engine_id uuid REFERENCES catalog.engines(id) ON DELETE CASCADE,
    ecu_family_id uuid REFERENCES catalog.ecu_families(id) ON DELETE CASCADE,
    notes text,
    evidence_level smallint NOT NULL DEFAULT 1 CHECK (evidence_level BETWEEN 1 AND 5),
    CHECK (num_nonnulls(engine_id, ecu_family_id) >= 1)
);

CREATE TABLE knowledge.claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type text NOT NULL CHECK (subject_type IN (
        'manufacturer', 'vehicle_model', 'model_generation', 'engine', 'vehicle_variant',
        'ecu_family', 'module_installation', 'diagnostic_parameter', 'dtc', 'procedure'
    )),
    subject_id uuid NOT NULL,
    predicate text NOT NULL,
    value jsonb NOT NULL,
    confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    verification_status text NOT NULL DEFAULT 'candidate'
        CHECK (verification_status IN ('candidate', 'corroborated', 'verified', 'conflicted', 'rejected', 'superseded')),
    risk_level text NOT NULL DEFAULT 'normal'
        CHECK (risk_level IN ('low', 'normal', 'high', 'safety_critical')),
    supersedes_claim_id uuid REFERENCES knowledge.claims(id) ON DELETE SET NULL,
    created_by_agent_run_id uuid,
    reviewed_by text,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.claim_evidence (
    claim_id uuid NOT NULL REFERENCES knowledge.claims(id) ON DELETE CASCADE,
    source_id uuid NOT NULL REFERENCES knowledge.sources(id) ON DELETE RESTRICT,
    document_chunk_id uuid REFERENCES knowledge.document_chunks(id) ON DELETE SET NULL,
    evidence_role text NOT NULL CHECK (evidence_role IN ('supports', 'contradicts', 'context')),
    locator jsonb NOT NULL DEFAULT '{}'::jsonb,
    excerpt text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (claim_id, source_id, evidence_role, locator)
);

CREATE TABLE ops.ingestion_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid REFERENCES knowledge.sources(id) ON DELETE SET NULL,
    job_type text NOT NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'waiting_review', 'completed', 'failed', 'cancelled')),
    input jsonb NOT NULL DEFAULT '{}'::jsonb,
    result jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_summary text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.agent_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ingestion_job_id uuid REFERENCES ops.ingestion_jobs(id) ON DELETE SET NULL,
    agent_name text NOT NULL,
    agent_version text NOT NULL,
    model text,
    prompt_version text,
    input_hash text,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'blocked')),
    token_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
    tool_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
    output jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_summary text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

ALTER TABLE knowledge.claims
    ADD CONSTRAINT claims_agent_run_fk
    FOREIGN KEY (created_by_agent_run_id) REFERENCES ops.agent_runs(id) ON DELETE SET NULL;

CREATE TABLE ops.review_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    reason text NOT NULL,
    severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'approved', 'rejected', 'resolved')),
    assigned_to text,
    resolution_notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);

CREATE TABLE runtime.user_vehicles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_subject_id text,
    vehicle_variant_id uuid REFERENCES catalog.vehicle_variants(id) ON DELETE SET NULL,
    nickname text,
    vin_hash text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runtime.diagnostic_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schema_version integer NOT NULL DEFAULT 1,
    user_vehicle_id uuid REFERENCES runtime.user_vehicles(id) ON DELETE SET NULL,
    plan jsonb NOT NULL,
    symptoms text,
    conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    protocol_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'recording'
        CHECK (status IN ('recording', 'completed', 'aborted', 'uploaded', 'analyzed')),
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE runtime.obd_samples (
    session_id uuid NOT NULL REFERENCES runtime.diagnostic_sessions(id) ON DELETE CASCADE,
    sequence_no bigint NOT NULL CHECK (sequence_no >= 0),
    captured_at timestamptz NOT NULL,
    elapsed_ms bigint NOT NULL CHECK (elapsed_ms >= 0),
    values jsonb NOT NULL,
    raw_responses jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (session_id, sequence_no),
    CHECK (jsonb_typeof(values) = 'object')
);

CREATE TABLE runtime.dtc_observations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES runtime.diagnostic_sessions(id) ON DELETE CASCADE,
    code text NOT NULL,
    status text,
    raw_response text,
    observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runtime.ai_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES runtime.diagnostic_sessions(id) ON DELETE CASCADE,
    report_version integer NOT NULL DEFAULT 1,
    model text NOT NULL,
    prompt_version text NOT NULL,
    response_id text,
    report jsonb NOT NULL,
    evidence_claim_ids uuid[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, report_version)
);

CREATE INDEX sources_active_trust_idx ON knowledge.sources (trust_tier DESC) WHERE lifecycle_status = 'active';
CREATE INDEX documents_source_idx ON knowledge.documents (source_id, extraction_status);
CREATE INDEX chunks_document_idx ON knowledge.document_chunks (document_id, ordinal);
CREATE INDEX generations_model_idx ON catalog.model_generations (model_id);
CREATE INDEX variants_generation_engine_idx ON catalog.vehicle_variants (generation_id, engine_id);
CREATE INDEX parameters_mode_pid_idx ON catalog.diagnostic_parameters (service_mode, pid_code);
CREATE INDEX applicability_engine_idx ON catalog.parameter_applicability (engine_id, support_status);
CREATE INDEX claims_subject_idx ON knowledge.claims (subject_type, subject_id, predicate);
CREATE INDEX claims_review_idx ON knowledge.claims (verification_status, risk_level);
CREATE INDEX agent_runs_job_idx ON ops.agent_runs (ingestion_job_id, agent_name);
CREATE INDEX review_open_idx ON ops.review_items (severity DESC, created_at) WHERE status IN ('open', 'assigned');
CREATE INDEX sessions_vehicle_started_idx ON runtime.diagnostic_sessions (user_vehicle_id, started_at DESC);
CREATE INDEX samples_time_idx ON runtime.obd_samples (session_id, captured_at);

COMMIT;
